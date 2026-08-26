"""The runner half of the app: the wire contract, and the client that speaks it.

A runner is a remote worker, not a remote engine. Whole jobs go out as a serialized
`RunPlan` and whole results come back as `MoveEval` payloads, so nothing here is a chatty
tunnel over UCI. `protocol.py` is the one description of that wire, imported by the server
gateway and by the `blunderbase-runner` process alike — one module means a frame the
server sends is a frame the runner can decode, by construction rather than by convention.

Three modules make up the client half: `config.py` reads the `runner.yaml`, `client.py` is
the process itself — its engine pool, its link and the jobs on its slots — and
`entrypoint.py` is the `blunderbase-runner` console script over the top of them.

The layering rule that keeps this package importable from both sides: **nothing here opens
a `Session`.** `backend.db.models` is imported, because a `MoveEval` row is what crosses
the wire, and `services/analysis.py` is imported for `analyse_plan`, because a runner
computes exactly what the server would have — but the database is the server's business
and the runner has none.
"""
