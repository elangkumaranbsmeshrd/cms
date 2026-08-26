"""Phase 7 hardening round 2 — there was no application logging configuration
anywhere in this codebase before this: no logger calls, no formatter, no
level set. Unhandled exceptions were only ever visible via Starlette's
default stderr traceback (fine for `uvicorn --reload` on a dev box, useless
once gunicorn's `errorlog = "-"` (ARCH-3 §9.5) is the only place logs go).

Deliberately plain stdlib `logging`, one line per event, no JSON — that
matches how the rest of this deployment already reads logs (`journalctl -u
cms-api`), and ARCH-3 §9.5's gunicorn `access_log_format` already reads a
`request_id` field from an incoming header for the HTTP access line; this
module is what makes that id exist and lets application-level log calls
(rate-limit trips, unhandled exceptions) carry the same id for correlation.
"""

import contextvars
import logging

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


class _RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


def configure_logging(level: str = "INFO") -> None:
    handler = logging.StreamHandler()
    handler.addFilter(_RequestIdFilter())
    handler.setFormatter(logging.Formatter(
        fmt="%(asctime)s %(levelname)s %(name)s request_id=%(request_id)s %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S%z",
    ))
    root = logging.getLogger()
    root.handlers = [handler]
    root.setLevel(level)
