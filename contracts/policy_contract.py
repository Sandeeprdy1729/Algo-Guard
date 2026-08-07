"""
AgentGuard on-chain policy contract (PyTeal, ABI Router).

Per-agent state lives in a BOX whose name is the agent's 32-byte public key.
Layout (big-endian uint64 unless noted):

    off  size  field
    ---  ----  ----------------------------------------
      0    8   daily_cap_micro_usdc
      8    8   monthly_cap_micro_usdc
     16    8   human_threshold_micro_usdc
     24    8   daily_spent_micro_usdc
     32    8   monthly_spent_micro_usdc
     40    8   day_epoch                (unix / 86400)
     48    8   month_epoch              (year*12 + month, unused for now)
     56    8   flags                    (bit 0 = frozen)
     64    N   allowed_routes           (newline-separated utf8)

Global state:
    "admin" (bytes 32) — creator; only key allowed to mutate policy.

Log tags (materialized off-chain into audit_logs):
    "SPND" spend    "APOL" policy update    "AAPR" approval    "FRZE" freeze
"""
from pyteal import (
    App,
    Approve,
    Assert,
    BareCallActions,
    Bytes,
    BytesGt,
    BytesLe,
    CallConfig,
    Concat,
    Expr,
    Global,
    If,
    Int,
    Itob,
    Log,
    OnCompleteAction,
    Router,
    ScratchVar,
    Seq,
    TealType,
    Txn,
    abi,
    Btoi,
    BitwiseAnd,
    BitwiseOr,
)


ADMIN_KEY = Bytes("admin")


def only_admin() -> Expr:
    return Assert(Txn.sender() == App.globalGet(ADMIN_KEY))


def _box_u64(name: Expr, off: int) -> Expr:
    """Read 8 BE bytes at `off` from `name` and return as uint64."""
    return Btoi(App.box_extract(name, Int(off), Int(8)))


def _replace_u64(name: Expr, off: int, value: Expr) -> Expr:
    return App.box_replace(name, Int(off), Itob(value))


def _now_day() -> Expr:
    return Global.latest_timestamp() / Int(86400)


router = Router(
    "agentguard-policy",
    bare_calls=BareCallActions(
        no_op=OnCompleteAction.create_only(Seq(App.globalPut(ADMIN_KEY, Txn.sender()), Approve())),
        opt_in=OnCompleteAction.never(),
        close_out=OnCompleteAction.never(),
        update_application=OnCompleteAction.never(),
        delete_application=OnCompleteAction.never(),
    ),
)


@router.method(no_op=CallConfig.CALL)
def create_agent(
    agent: abi.Address,
    daily_cap: abi.Uint64,
    monthly_cap: abi.Uint64,
    human_threshold: abi.Uint64,
    routes: abi.String,
) -> Expr:
    name = agent.get()
    return Seq(
        only_admin(),
        # 64-byte header + routes payload
        Assert(App.box_create(name, Int(64) + routes.length())),
        _replace_u64(name, 0, daily_cap.get()),
        _replace_u64(name, 8, monthly_cap.get()),
        _replace_u64(name, 16, human_threshold.get()),
        _replace_u64(name, 24, Int(0)),  # daily_spent
        _replace_u64(name, 32, Int(0)),  # monthly_spent
        _replace_u64(name, 40, _now_day()),
        _replace_u64(name, 48, Int(0)),  # month_epoch (reserved)
        _replace_u64(name, 56, Int(0)),  # flags
        App.box_replace(name, Int(64), routes.get()),
        Log(Concat(Bytes("APOL"), name, Itob(daily_cap.get()), Itob(monthly_cap.get()))),
        Approve(),
    )


@router.method(no_op=CallConfig.CALL)
def update_policy(
    agent: abi.Address,
    daily_cap: abi.Uint64,
    monthly_cap: abi.Uint64,
    human_threshold: abi.Uint64,
) -> Expr:
    """Update caps only; allowed_routes need a separate call because
    resizing a box is a heavier op — kept out of the demo path."""
    name = agent.get()
    return Seq(
        only_admin(),
        _replace_u64(name, 0, daily_cap.get()),
        _replace_u64(name, 8, monthly_cap.get()),
        _replace_u64(name, 16, human_threshold.get()),
        Log(Concat(Bytes("APOL"), name, Itob(daily_cap.get()), Itob(monthly_cap.get()))),
        Approve(),
    )


@router.method(no_op=CallConfig.CALL)
def record_spend(
    agent: abi.Address,
    amount: abi.Uint64,
    route_hash: abi.DynamicBytes,
) -> Expr:
    """Debit the agent's spend counters. MUST be called in an atomic group
    together with the USDC transfer. If any assert fails, the whole group
    reverts."""
    name = agent.get()
    daily_cap = ScratchVar(TealType.uint64)
    monthly_cap = ScratchVar(TealType.uint64)
    daily_spent = ScratchVar(TealType.uint64)
    monthly_spent = ScratchVar(TealType.uint64)
    day_epoch = ScratchVar(TealType.uint64)
    flags = ScratchVar(TealType.uint64)
    new_day = ScratchVar(TealType.uint64)

    return Seq(
        daily_cap.store(_box_u64(name, 0)),
        monthly_cap.store(_box_u64(name, 8)),
        daily_spent.store(_box_u64(name, 24)),
        monthly_spent.store(_box_u64(name, 32)),
        day_epoch.store(_box_u64(name, 40)),
        flags.store(_box_u64(name, 56)),
        new_day.store(_now_day()),
        # not frozen
        Assert(BitwiseAnd(flags.load(), Int(1)) == Int(0)),
        # roll daily counter if new day
        If(new_day.load() != day_epoch.load()).Then(
            Seq(
                daily_spent.store(Int(0)),
                _replace_u64(name, 24, Int(0)),
                _replace_u64(name, 40, new_day.load()),
            )
        ),
        # caps (spent + amount ≤ cap)
        Assert(daily_spent.load() + amount.get() <= daily_cap.load()),
        Assert(monthly_spent.load() + amount.get() <= monthly_cap.load()),
        # debit
        _replace_u64(name, 24, daily_spent.load() + amount.get()),
        _replace_u64(name, 32, monthly_spent.load() + amount.get()),
        Log(Concat(Bytes("SPND"), name, Itob(amount.get()), route_hash.get())),
        Approve(),
    )


@router.method(no_op=CallConfig.CALL)
def approve_intent(intent_id: abi.Uint64) -> Expr:
    """Human approver signs the intent on-chain. Any signer is acceptable
    for the demo — the middleware verifies the approver is registered."""
    return Seq(
        Log(Concat(Bytes("AAPR"), Txn.sender(), Itob(intent_id.get()))),
        Approve(),
    )


@router.method(no_op=CallConfig.CALL)
def freeze_agent(agent: abi.Address) -> Expr:
    name = agent.get()
    flags = ScratchVar(TealType.uint64)
    return Seq(
        only_admin(),
        flags.store(_box_u64(name, 56)),
        _replace_u64(name, 56, BitwiseOr(flags.load(), Int(1))),
        Log(Concat(Bytes("FRZE"), name)),
        Approve(),
    )


if __name__ == "__main__":
    import json
    import pathlib

    approval, clear, contract = router.compile_program(version=8)
    out = pathlib.Path(__file__).parent / "build"
    out.mkdir(exist_ok=True)
    (out / "approval.teal").write_text(approval)
    (out / "clear.teal").write_text(clear)
    (out / "contract.json").write_text(json.dumps(contract.dictify(), indent=2))
    print(f"wrote {out}")
    print(f"  approval.teal   {len(approval)} chars")
    print(f"  clear.teal      {len(clear)} chars")
    print(f"  contract.json   methods = {[m['name'] for m in contract.dictify()['methods']]}")
