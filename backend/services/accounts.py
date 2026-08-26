"""The usernames the owner plays under, and which side of a stored game they make them.

An `Account` row is the only thing that turns a player name into "you". The import
pipeline reads the rows through `AccountIndex` on the way in, which means a game synced
before its account existed is stored with no `owner_color` at all — and `owner_color` is
what every "which side was I?" reader is keyed on, from the opponent's name to the
ratings to the win/loss column. `register_account` therefore writes the row a sync was
asked for, and `reconcile_games` re-runs the match over what is already stored, so the
answer to "which side was I?" is repaired rather than only avoided next time.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import ColumnElement, and_, func, select, update
from sqlalchemy.orm import Session

from backend.db.enums import Color, Platform, Source
from backend.db.models import Account, Game

# Which platform's accounts name the owner in a game from this source. A PGN or a manual
# game belongs to no platform, so it matches an account by username alone.
PLATFORM_FOR_SOURCE: dict[Source, Platform] = {
    Source.LICHESS: Platform.LICHESS,
    Source.CHESSCOM: Platform.CHESSCOM,
}

SOURCE_FOR_PLATFORM: dict[Platform, Source] = {
    platform: source for source, platform in PLATFORM_FOR_SOURCE.items()
}

# The sources whose games name no platform, and so are matched on the username alone.
PLATFORMLESS_SOURCES: tuple[Source, ...] = tuple(
    source for source in Source if source not in PLATFORM_FOR_SOURCE
)


@dataclass(slots=True)
class AccountIndex:
    """The owner's usernames, which is what decides which side of a game is "you"."""

    entries: list[tuple[int, Platform, str, bool]] = field(default_factory=list)

    @classmethod
    def load(cls, session: Session) -> AccountIndex:
        accounts = session.scalars(select(Account).order_by(Account.id)).all()
        return cls(
            entries=[
                (account.id, account.platform, fold(account.username), account.is_owner)
                for account in accounts
            ]
        )

    def match(self, source: Source, name: str) -> tuple[int | None, bool]:
        """The account this player name is, and whether that account is the owner's.

        A source that names a platform matches on that platform only — a stranger on
        chess.com may well be called what the owner is called on Lichess. A PGN or a
        manual game belongs to no platform, so it matches on the username alone, and where
        several accounts share one the owner's wins: the same handle on two sites is still
        the same person.
        """
        folded = fold(name)
        if not folded:
            return None, False

        platform = PLATFORM_FOR_SOURCE.get(source)
        if platform is not None:
            for identifier, account_platform, username, is_owner in self.entries:
                if account_platform == platform and username == folded:
                    return identifier, is_owner
            return None, False

        candidates = [entry for entry in self.entries if entry[2] == folded]
        owners = [entry for entry in candidates if entry[3]]
        if owners:
            return owners[0][0], True
        if len(candidates) == 1:
            return candidates[0][0], candidates[0][3]
        return None, False


@dataclass(slots=True)
class Reconciled:
    """What one reconciliation filled in, in games rather than in statements."""

    # Games whose white or black side gained the account link it was missing.
    linked: int = 0
    # Games that gained an owner colour, which is what makes them the owner's at all.
    colored: int = 0


def find_account(session: Session, platform: Platform | str, username: str) -> Account | None:
    """The account for this username on this platform, whatever it is capitalised as.

    Lichess and chess.com both read a username case-insensitively, so `Phib2` and `phib2`
    are one account; the unique constraint over (platform, username) does not, which is
    why this asks the database to fold rather than looking the name up as it was typed.
    Where an old row and a new one differ only in case, the owner's is the answer.
    """
    folded = fold(username)
    if not folded:
        return None
    statement = (
        select(Account)
        .where(Account.platform == Platform(platform), func.lower(Account.username) == folded)
        .order_by(Account.is_owner.desc(), Account.id)
    )
    return session.scalars(statement).first()


def register_account(
    session: Session,
    platform: Platform | str,
    username: str,
    *,
    display_name: str | None = None,
    reconcile: bool = True,
) -> Account:
    """The owner's account on this platform, created if this is the first time it is seen.

    A sync is asked for by username, and in a database with one user the person asking is
    that user: the account a sync names is the owner's whatever a row said before, because
    it is the only thing that can decide `owner_color` for the games it appears in.
    Registering re-runs the match over what is already stored, so an account added after
    its games repairs them rather than only naming the ones that come next.
    """
    name = (username or "").strip()
    if not name:
        raise ValueError("an account needs a username")

    account = find_account(session, platform, name)
    if account is None:
        account = Account(
            platform=Platform(platform), username=name, display_name=display_name, is_owner=True
        )
        session.add(account)
    else:
        account.is_owner = True
        if display_name is not None:
            account.display_name = display_name
    session.commit()

    if reconcile:
        reconcile_games(session, account)
    return account


def reconcile_games(session: Session, account: Account | None = None) -> Reconciled:
    """Re-derive the account links and the owner colour of games that were stored without.

    Only the columns that are still empty are written, so this heals what an import could
    not know and never revises what one decided: a game whose owner colour is already set
    keeps it, whichever account is being reconciled. The match is the same rule
    `AccountIndex` applies on the way in — a platform's games by platform and username, a
    PGN's by username alone — so a repair claims exactly the games a sync would have.

    Every account costs a handful of bulk UPDATEs whatever the size of the table, which is
    what makes this cheap enough to run after every import.
    """
    accounts = list(session.scalars(select(Account).order_by(Account.id)))
    targets = [row for row in accounts if account is None or row.id == account.id]

    filled = Reconciled()
    for target in targets:
        folded = fold(target.username)
        sources = claimable_sources(target, accounts)
        if not folded or not sources:
            continue
        for name_column, account_column, color in (
            (Game.white_name, Game.white_account_id, Color.WHITE),
            (Game.black_name, Game.black_account_id, Color.BLACK),
        ):
            played = and_(Game.source.in_(sources), func.lower(name_column) == folded)
            filled.linked += _fill(
                session, and_(played, account_column.is_(None)), {account_column: target.id}
            )
            if target.is_owner:
                filled.colored += _fill(
                    session, and_(played, Game.owner_color.is_(None)), {Game.owner_color: color}
                )
    session.commit()
    # The rows went out as bulk statements, so whatever this Session had already loaded
    # still remembers the values from before; the next read of one comes off the database.
    session.expire_all()
    return filled


def claimable_sources(account: Account, accounts: Sequence[Account]) -> list[Source]:
    """The sources whose games this account can be a player in.

    Its own platform's always; a PGN's or a manual game's only where this account is the
    one its username resolves to, which is the tie-break `AccountIndex.match` applies —
    the owner's row wins, and a name two rows share and neither owns names nobody.
    """
    sources: list[Source] = []
    own = SOURCE_FOR_PLATFORM.get(account.platform)
    if own is not None:
        sources.append(own)
    if _wins_username(account, accounts):
        sources.extend(PLATFORMLESS_SOURCES)
    return sources


def fold(name: str | None) -> str:
    """A username as it is compared: trimmed and case-folded, never stored this way."""
    return (name or "").strip().casefold()


def _wins_username(account: Account, accounts: Sequence[Account]) -> bool:
    candidates = [row for row in accounts if fold(row.username) == fold(account.username)]
    owners = [row for row in candidates if row.is_owner]
    if owners:
        return owners[0].id == account.id
    return len(candidates) == 1


def _fill(
    session: Session, condition: ColumnElement[bool], values: Mapping[Any, Any]
) -> int:
    """One bulk UPDATE over `games`, reporting how many rows it touched."""
    result = session.execute(
        update(Game).where(condition).values(values),
        execution_options={"synchronize_session": False},
    )
    return int(result.rowcount or 0)
