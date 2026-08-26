"""`/accounts` — the usernames the owner plays under, and the repair that applies them.

An account row is what turns a player name in a stored game into "you", so a library
imported before its account existed has no owner colour and reads as nobody's. Registering
one here writes the row and re-runs the match over what is already stored; `/reconcile`
runs that repair on its own, for a database whose accounts are all present already.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from sqlalchemy.orm import Session

from backend.api.deps import SessionDep
from backend.api.schemas import (
    AccountCreate,
    AccountRegistered,
    AccountResponse,
    Reconciliation,
)
from backend.services import accounts as accounts_service

router = APIRouter(prefix="/accounts", tags=["accounts"])


@router.get("", response_model=list[AccountResponse], summary="Every account")
def list_accounts(session: SessionDep) -> list[Any]:
    return accounts_service.list_accounts(session)


@router.post("", response_model=AccountRegistered, summary="Register an account")
def register_account(session: SessionDep, body: AccountCreate) -> AccountRegistered:
    """Name a username as the owner's, and claim the games it has already played.

    Answers 200 rather than 201: an account that was already there is marked the owner's
    and reconciled again, which is the same request and not a second row.
    """
    account, filled = accounts_service.register_and_reconcile(
        session, body.platform, body.username, display_name=body.display_name
    )
    counts = accounts_service.attributed_counts(session)
    return AccountRegistered(
        account=AccountResponse.model_validate(
            accounts_service.account_payload(account, counts.get(account.id, 0))
        ),
        reconciled=_reconciliation(session, filled),
    )


@router.post("/reconcile", response_model=Reconciliation, summary="Repair owner attribution")
def reconcile(session: SessionDep) -> Reconciliation:
    """Re-derive the account links and owner colours of games stored without them.

    Idempotent and non-destructive: only empty columns are written, so a second run over
    a healthy library fills in nothing.
    """
    return _reconciliation(session, accounts_service.reconcile_games(session))


def _reconciliation(session: Session, filled: accounts_service.Reconciled) -> Reconciliation:
    return Reconciliation(
        linked=filled.linked,
        colored=filled.colored,
        unclaimed=accounts_service.unclaimed_games(session),
    )
