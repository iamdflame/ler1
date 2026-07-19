use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{get_return_data, invoke},
    pubkey,
};

// Reproducing this program needs no keypair; deployment at this address does.
// Its matching private key is intentionally not part of this repository.
declare_id!("6d1Se4dj5yw11sDeT2Uss7iNVxuecHRMazZ1wgB32HFy");

const TXORACLE_DEVNET: Pubkey = pubkey!("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J");
const TXORACLE_MAINNET: Pubkey = pubkey!("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA");
const VALIDATE_STAT_DISCRIMINATOR: [u8; 8] = [107, 197, 232, 90, 191, 136, 105, 185];
const MILLIS_PER_DAY: i64 = 86_400_000;
const MAX_REACTION_CLOCK_SKEW_MS: i64 = 3_600_000;

pub const EVENT_GOAL: u8 = 1;
pub const EVENT_GOAL_REVOKED: u8 = 2;
pub const EVENT_RED_CARD: u8 = 3;
pub const EVENT_CARD_REVOKED: u8 = 4;
pub const PARTICIPANT_1: u8 = 1;
pub const PARTICIPANT_2: u8 = 2;

#[program]
pub mod roarline_receipts {
    use super::*;

    /// Verify a fixture/stat-key/value inside TxLINE, then store it beside a
    /// broadcaster-supplied package commitment and bounded timing metadata.
    /// The receipt PDA is immutable unless a later, separately verified
    /// correction sets its `superseded_by` pointer.
    pub fn record_moment(
        ctx: Context<RecordMoment>,
        args: ReceiptArgs,
        proof: ValidateProof,
    ) -> Result<()> {
        require!(
            !is_correction(args.event_type),
            ReceiptError::CorrectionInstructionRequired
        );
        require!(
            args.previous_package_hash == [0; 32],
            ReceiptError::UnexpectedPreviousHash
        );
        require!(valid_original_value(args.event_value), ReceiptError::InvalidOriginalValue);
        verify_and_write(
            &ctx.accounts.broadcaster,
            &ctx.accounts.daily_scores_merkle_roots,
            &ctx.accounts.txoracle_program,
            &mut ctx.accounts.receipt,
            &args,
            &proof,
            Pubkey::default(),
            ctx.bumps.receipt,
        )
    }

    /// A correction never erases history. It validates the corrected TxLINE
    /// stat, creates a new receipt, and links both directions atomically.
    pub fn record_correction(
        ctx: Context<RecordCorrection>,
        args: ReceiptArgs,
        proof: ValidateProof,
    ) -> Result<()> {
        require!(is_correction(args.event_type), ReceiptError::NotCorrection);
        require!(
            args.previous_package_hash != [0; 32],
            ReceiptError::MissingPreviousHash
        );
        require!(
            ctx.accounts.previous_receipt.fixture_id == args.fixture_id,
            ReceiptError::FixtureMismatch
        );
        require!(
            ctx.accounts.previous_receipt.stat_key == proof.stat_a.stat_to_prove.key,
            ReceiptError::StatMismatch
        );
        require!(
            ctx.accounts.previous_receipt.package_hash == args.previous_package_hash,
            ReceiptError::PreviousPackageMismatch
        );
        require!(
            correction_target(args.event_type) == Some(ctx.accounts.previous_receipt.event_type),
            ReceiptError::WrongCorrectionTarget
        );
        require!(
            args.seq > ctx.accounts.previous_receipt.seq
                && args.source_ts >= ctx.accounts.previous_receipt.source_ts,
            ReceiptError::CorrectionOutOfOrder
        );
        require!(
            ctx.accounts.previous_receipt.superseded_by == Pubkey::default(),
            ReceiptError::AlreadySuperseded
        );
        require!(
            valid_correction_value(ctx.accounts.previous_receipt.event_value, args.event_value),
            ReceiptError::InvalidCorrectionValue
        );

        let previous_key = ctx.accounts.previous_receipt.key();
        verify_and_write(
            &ctx.accounts.broadcaster,
            &ctx.accounts.daily_scores_merkle_roots,
            &ctx.accounts.txoracle_program,
            &mut ctx.accounts.receipt,
            &args,
            &proof,
            previous_key,
            ctx.bumps.receipt,
        )?;
        ctx.accounts.previous_receipt.superseded_by = ctx.accounts.receipt.key();
        emit!(MomentSuperseded {
            previous_receipt: previous_key,
            correction_receipt: ctx.accounts.receipt.key(),
            fixture_id: args.fixture_id,
        });
        Ok(())
    }
}

fn verify_and_write<'info>(
    broadcaster: &Signer<'info>,
    daily_roots: &UncheckedAccount<'info>,
    txoracle_program: &UncheckedAccount<'info>,
    receipt: &mut Account<'info, MomentReceipt>,
    args: &ReceiptArgs,
    proof: &ValidateProof,
    previous_receipt: Pubkey,
    bump: u8,
) -> Result<()> {
    require!(
        valid_event_type(args.event_type),
        ReceiptError::BadEventType
    );
    require!(args.package_hash != [0; 32], ReceiptError::EmptyPackageHash);
    require!(
        args.source_entry_hash != [0; 32],
        ReceiptError::EmptySourceHash
    );
    require!(
        args.reaction_ts >= args.source_ts,
        ReceiptError::ReactionBeforeSource
    );
    require!(
        proof.fixture_summary.fixture_id == args.fixture_id,
        ReceiptError::FixtureMismatch
    );
    require!(
        proof.stat_a.stat_to_prove.key == args.stat_key,
        ReceiptError::StatMismatch
    );
    require!(
        proof.stat_a.stat_to_prove.value == args.event_value,
        ReceiptError::ValueMismatch
    );
    require!(
        event_matches_stat(args.event_type, args.team, args.stat_key),
        ReceiptError::EventStatMismatch
    );
    require!(
        proof.proof_ts == proof.fixture_summary.update_stats.min_timestamp,
        ReceiptError::ProofTimestampMismatch
    );
    require!(
        args.source_ts >= proof.fixture_summary.update_stats.min_timestamp
            && args.source_ts <= proof.fixture_summary.update_stats.max_timestamp,
        ReceiptError::SourceTimestampOutsideBatch
    );
    let chain_ts = Clock::get()?.unix_timestamp.saturating_mul(1000);
    require!(
        args.reaction_ts >= chain_ts.saturating_sub(MAX_REACTION_CLOCK_SKEW_MS)
            && args.reaction_ts <= chain_ts.saturating_add(1_000),
        ReceiptError::ReactionTimestampOutsideWindow
    );

    let oracle = txoracle_program.key();
    require!(
        oracle == TXORACLE_DEVNET || oracle == TXORACLE_MAINNET,
        ReceiptError::BadOracleProgram
    );
    require!(
        txoracle_program.to_account_info().executable,
        ReceiptError::OracleNotExecutable
    );
    let epoch_day = proof.proof_ts.div_euclid(MILLIS_PER_DAY);
    require!(
        (0..=u16::MAX as i64).contains(&epoch_day),
        ReceiptError::BadProofTimestamp
    );
    let day_seed = (epoch_day as u16).to_le_bytes();
    let (expected_roots, _) =
        Pubkey::find_program_address(&[b"daily_scores_roots", &day_seed], &oracle);
    require_keys_eq!(
        daily_roots.key(),
        expected_roots,
        ReceiptError::BadRootsAddress
    );
    require!(
        *daily_roots.to_account_info().owner == oracle,
        ReceiptError::BadRootsOwner
    );

    // Exact equality proves the value written into the receipt; the broadcaster
    // cannot validate one fact and publish another.
    let ix_args = ValidateStatArgs {
        ts: proof.proof_ts,
        fixture_summary: proof.fixture_summary.clone(),
        fixture_proof: proof.fixture_proof.clone(),
        main_tree_proof: proof.main_tree_proof.clone(),
        predicate: TraderPredicate {
            threshold: args.event_value,
            comparison: Comparison::EqualTo,
        },
        stat_a: proof.stat_a.clone(),
        stat_b: None,
        op: None,
    };
    let mut data = VALIDATE_STAT_DISCRIMINATOR.to_vec();
    data.extend_from_slice(&ix_args.try_to_vec()?);
    let ix = Instruction {
        program_id: oracle,
        accounts: vec![AccountMeta::new_readonly(daily_roots.key(), false)],
        data,
    };
    invoke(
        &ix,
        &[
            daily_roots.to_account_info(),
            txoracle_program.to_account_info(),
        ],
    )?;

    let (return_program, return_data) = get_return_data().ok_or(ReceiptError::NoOracleVerdict)?;
    require_keys_eq!(return_program, oracle, ReceiptError::NoOracleVerdict);
    require!(return_data.as_slice() == [1], ReceiptError::OracleRejected);

    receipt.broadcaster = broadcaster.key();
    receipt.fixture_id = args.fixture_id;
    receipt.seq = args.seq;
    receipt.event_type = args.event_type;
    receipt.team = args.team;
    receipt.stat_key = args.stat_key;
    receipt.event_value = args.event_value;
    receipt.source_ts = args.source_ts;
    receipt.reaction_ts = args.reaction_ts;
    receipt.proof_ts = proof.proof_ts;
    receipt.package_hash = args.package_hash;
    receipt.source_entry_hash = args.source_entry_hash;
    receipt.previous_receipt = previous_receipt;
    receipt.superseded_by = Pubkey::default();
    receipt.txoracle_program = oracle;
    receipt.daily_scores_merkle_roots = daily_roots.key();
    receipt.verified = true;
    receipt.bump = bump;

    emit!(MomentReceiptCreated {
        receipt: receipt.key(),
        broadcaster: broadcaster.key(),
        fixture_id: args.fixture_id,
        seq: args.seq,
        event_type: args.event_type,
        team: args.team,
        event_value: args.event_value,
        source_ts: args.source_ts,
        reaction_ts: args.reaction_ts,
        package_hash: args.package_hash,
        previous_receipt,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(args: ReceiptArgs)]
pub struct RecordMoment<'info> {
    #[account(mut)]
    pub broadcaster: Signer<'info>,
    #[account(
        init,
        payer = broadcaster,
        space = 8 + MomentReceipt::INIT_SPACE,
        seeds = [
            b"moment",
            broadcaster.key().as_ref(),
            &args.package_hash,
        ],
        bump,
    )]
    pub receipt: Account<'info, MomentReceipt>,
    /// CHECK: owner-pinned and allowlisted before CPI.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    /// CHECK: allowlisted to TxLINE devnet/mainnet before CPI.
    pub txoracle_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(args: ReceiptArgs)]
pub struct RecordCorrection<'info> {
    #[account(mut)]
    pub broadcaster: Signer<'info>,
    #[account(
        mut,
        has_one = broadcaster @ ReceiptError::WrongBroadcaster,
    )]
    pub previous_receipt: Account<'info, MomentReceipt>,
    #[account(
        init,
        payer = broadcaster,
        space = 8 + MomentReceipt::INIT_SPACE,
        seeds = [
            b"moment",
            broadcaster.key().as_ref(),
            &args.package_hash,
        ],
        bump,
    )]
    pub receipt: Account<'info, MomentReceipt>,
    /// CHECK: owner-pinned and allowlisted before CPI.
    pub daily_scores_merkle_roots: UncheckedAccount<'info>,
    /// CHECK: allowlisted to TxLINE devnet/mainnet before CPI.
    pub txoracle_program: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct MomentReceipt {
    pub broadcaster: Pubkey,
    /// CPI-bound to `fixture_summary.fixture_id`.
    pub fixture_id: i64,
    /// Broadcaster-supplied source sequence; corrections must increase it.
    pub seq: u32,
    /// Broadcaster classification, constrained to the proven stat-key family.
    pub event_type: u8,
    /// Broadcaster participant classification: 1 = TxLINE Participant 1,
    /// 2 = TxLINE Participant 2. It must match the stat key proven by the CPI.
    pub team: u8,
    /// CPI-bound to `stat_to_prove.key`.
    pub stat_key: u32,
    /// CPI-bound to `stat_to_prove.value` and exact-equality validation.
    pub event_value: i32,
    /// Broadcaster-supplied source timestamp, constrained to the proven
    /// TxLINE batch's min/max range; not proven as an exact event timestamp.
    pub source_ts: i64,
    /// Broadcaster-supplied package timestamp, constrained to be after
    /// `source_ts` and near the Solana Clock at receipt creation.
    pub reaction_ts: i64,
    /// TxLINE batch minTimestamp used by validate_stat.
    pub proof_ts: i64,
    /// Broadcaster-supplied SHA-256 commitment. Address derivation binds the
    /// receipt to these bytes; this program does not recompute off-chain data.
    pub package_hash: [u8; 32],
    /// Broadcaster-supplied source-ledger commitment; not interpreted on chain.
    pub source_entry_hash: [u8; 32],
    pub previous_receipt: Pubkey,
    pub superseded_by: Pubkey,
    pub txoracle_program: Pubkey,
    pub daily_scores_merkle_roots: Pubkey,
    /// True only after TxLINE returned the exact one-byte validation verdict;
    /// it does not independently verify broadcaster-supplied metadata above.
    pub verified: bool,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ReceiptArgs {
    /// CPI-bound fixture identifier.
    pub fixture_id: i64,
    /// Broadcaster metadata; only relative correction ordering is enforced.
    pub seq: u32,
    /// Broadcaster classification constrained by `stat_key` and `team`.
    pub event_type: u8,
    pub team: u8,
    /// CPI-bound stat coordinates and exact value.
    pub stat_key: u32,
    pub event_value: i32,
    /// Broadcaster timestamps with batch and Solana Clock bounds.
    pub source_ts: i64,
    pub reaction_ts: i64,
    /// Broadcaster commitments; package bytes are not supplied to the program.
    pub package_hash: [u8; 32],
    pub source_entry_hash: [u8; 32],
    /// Zero for an original moment; exact prior package SHA-256 for corrections.
    pub previous_package_hash: [u8; 32],
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ValidateProof {
    pub proof_ts: i64,
    pub fixture_summary: ScoresBatchSummary,
    pub fixture_proof: Vec<ProofNode>,
    pub main_tree_proof: Vec<ProofNode>,
    pub stat_a: StatTerm,
}

// txoracle::validate_stat wire layout, generated from the official on-chain IDL.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresUpdateStats {
    pub update_count: i32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoresBatchSummary {
    pub fixture_id: i64,
    pub update_stats: ScoresUpdateStats,
    pub events_sub_tree_root: [u8; 32],
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ProofNode {
    pub hash: [u8; 32],
    pub is_right_sibling: bool,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct ScoreStat {
    pub key: u32,
    pub value: i32,
    pub period: i32,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct StatTerm {
    pub stat_to_prove: ScoreStat,
    pub event_stat_root: [u8; 32],
    pub stat_proof: Vec<ProofNode>,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum Comparison {
    GreaterThan,
    LessThan,
    EqualTo,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct TraderPredicate {
    pub threshold: i32,
    pub comparison: Comparison,
}
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub enum BinaryExpression {
    Add,
    Subtract,
}
#[derive(AnchorSerialize)]
struct ValidateStatArgs {
    ts: i64,
    fixture_summary: ScoresBatchSummary,
    fixture_proof: Vec<ProofNode>,
    main_tree_proof: Vec<ProofNode>,
    predicate: TraderPredicate,
    stat_a: StatTerm,
    stat_b: Option<StatTerm>,
    op: Option<BinaryExpression>,
}

#[event]
pub struct MomentReceiptCreated {
    pub receipt: Pubkey,
    pub broadcaster: Pubkey,
    pub fixture_id: i64,
    pub seq: u32,
    pub event_type: u8,
    pub team: u8,
    pub event_value: i32,
    pub source_ts: i64,
    pub reaction_ts: i64,
    pub package_hash: [u8; 32],
    pub previous_receipt: Pubkey,
}

#[event]
pub struct MomentSuperseded {
    pub previous_receipt: Pubkey,
    pub correction_receipt: Pubkey,
    pub fixture_id: i64,
}

#[error_code]
pub enum ReceiptError {
    #[msg("Unsupported broadcast event type")]
    BadEventType,
    #[msg("Correction event must use record_correction")]
    CorrectionInstructionRequired,
    #[msg("Event is not a correction")]
    NotCorrection,
    #[msg("Fixture does not match proof or previous receipt")]
    FixtureMismatch,
    #[msg("Stat key does not match receipt")]
    StatMismatch,
    #[msg("Proven value does not match receipt")]
    ValueMismatch,
    #[msg("Event type or team does not match the proven stat key")]
    EventStatMismatch,
    #[msg("Original event value must be positive")]
    InvalidOriginalValue,
    #[msg("Correction value must be non-negative and lower than the original")]
    InvalidCorrectionValue,
    #[msg("Package hash cannot be zero")]
    EmptyPackageHash,
    #[msg("Source ledger hash cannot be zero")]
    EmptySourceHash,
    #[msg("Reaction timestamp precedes source timestamp")]
    ReactionBeforeSource,
    #[msg("Source timestamp is outside the proven TxLINE batch")]
    SourceTimestampOutsideBatch,
    #[msg("Reaction timestamp is outside the allowed Solana clock window")]
    ReactionTimestampOutsideWindow,
    #[msg("TxLINE program is not an allowlisted deployment")]
    BadOracleProgram,
    #[msg("Daily roots account is not owned by the supplied TxLINE program")]
    BadRootsOwner,
    #[msg("TxLINE returned no validation verdict")]
    NoOracleVerdict,
    #[msg("TxLINE rejected the exact-value predicate")]
    OracleRejected,
    #[msg("Previous receipt already has a correction")]
    AlreadySuperseded,
    #[msg("Only the original broadcaster may correct this receipt")]
    WrongBroadcaster,
    #[msg("Original moments cannot name a previous package")]
    UnexpectedPreviousHash,
    #[msg("Corrections must name the previous package")]
    MissingPreviousHash,
    #[msg("Previous receipt does not match the package being superseded")]
    PreviousPackageMismatch,
    #[msg("Correction targets the wrong receipt event type")]
    WrongCorrectionTarget,
    #[msg("Correction must follow the original receipt")]
    CorrectionOutOfOrder,
    #[msg("Proof timestamp must equal the batch minimum timestamp")]
    ProofTimestampMismatch,
    #[msg("Proof timestamp is outside the supported daily-root range")]
    BadProofTimestamp,
    #[msg("Daily roots account is not the PDA for the proof day")]
    BadRootsAddress,
    #[msg("TxLINE program account is not executable")]
    OracleNotExecutable,
}

fn valid_event_type(value: u8) -> bool {
    matches!(
        value,
        EVENT_GOAL | EVENT_GOAL_REVOKED | EVENT_RED_CARD | EVENT_CARD_REVOKED
    )
}

fn valid_original_value(value: i32) -> bool {
    value > 0
}

fn valid_correction_value(original: i32, corrected: i32) -> bool {
    corrected >= 0 && corrected < original
}

fn event_matches_stat(event_type: u8, team: u8, stat_key: u32) -> bool {
    let base_key = stat_key % 1000;
    match (event_type, team) {
        (EVENT_GOAL | EVENT_GOAL_REVOKED, PARTICIPANT_1) => base_key == 1,
        (EVENT_GOAL | EVENT_GOAL_REVOKED, PARTICIPANT_2) => base_key == 2,
        (EVENT_RED_CARD | EVENT_CARD_REVOKED, PARTICIPANT_1) => base_key == 5,
        (EVENT_RED_CARD | EVENT_CARD_REVOKED, PARTICIPANT_2) => base_key == 6,
        _ => false,
    }
}

fn is_correction(value: u8) -> bool {
    matches!(value, EVENT_GOAL_REVOKED | EVENT_CARD_REVOKED)
}

fn correction_target(value: u8) -> Option<u8> {
    match value {
        EVENT_GOAL_REVOKED => Some(EVENT_GOAL),
        EVENT_CARD_REVOKED => Some(EVENT_RED_CARD),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_types_are_closed() {
        assert!(valid_event_type(EVENT_GOAL));
        assert!(valid_event_type(EVENT_CARD_REVOKED));
        assert!(!valid_event_type(0));
        assert!(!valid_event_type(5));
        assert!(!valid_event_type(99));
    }

    #[test]
    fn values_require_positive_originals_and_strictly_lower_corrections() {
        assert!(valid_original_value(1));
        assert!(!valid_original_value(0));
        assert!(!valid_original_value(-1));
        assert!(valid_correction_value(3, 2));
        assert!(valid_correction_value(1, 0));
        assert!(!valid_correction_value(2, 2));
        assert!(!valid_correction_value(2, 3));
        assert!(!valid_correction_value(2, -1));
    }

    #[test]
    fn event_team_must_match_the_proven_stat_family() {
        assert!(event_matches_stat(EVENT_GOAL, PARTICIPANT_1, 1));
        assert!(event_matches_stat(EVENT_GOAL_REVOKED, PARTICIPANT_2, 2002));
        assert!(event_matches_stat(EVENT_RED_CARD, PARTICIPANT_1, 5));
        assert!(event_matches_stat(EVENT_CARD_REVOKED, PARTICIPANT_2, 6));
        assert!(!event_matches_stat(EVENT_GOAL, PARTICIPANT_1, 2));
        assert!(!event_matches_stat(EVENT_RED_CARD, PARTICIPANT_2, 4));
    }

    #[test]
    fn only_reversals_are_corrections() {
        assert!(is_correction(EVENT_GOAL_REVOKED));
        assert!(is_correction(EVENT_CARD_REVOKED));
        assert!(!is_correction(EVENT_GOAL));
    }

    #[test]
    fn corrections_target_the_matching_original_type() {
        assert_eq!(correction_target(EVENT_GOAL_REVOKED), Some(EVENT_GOAL));
        assert_eq!(correction_target(EVENT_CARD_REVOKED), Some(EVENT_RED_CARD));
        assert_eq!(correction_target(EVENT_GOAL), None);
    }
}
