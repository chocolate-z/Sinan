"""SQLite 迁移自测:应用 0001_init.sql,校验表/约束,且 credentials 无明文 token 列(红线#4)。"""

import sqlite3
from pathlib import Path

import pytest

_MIGRATION = (
    Path(__file__).resolve().parents[3]
    / "services" / "api" / "src" / "db" / "migrations" / "0001_init.sql"
)


def _apply(tmp_path) -> sqlite3.Connection:
    con = sqlite3.connect(tmp_path / "t.db")
    con.execute("PRAGMA foreign_keys=ON")
    con.executescript(_MIGRATION.read_text(encoding="utf-8"))
    return con


def test_tables_created(tmp_path):
    con = _apply(tmp_path)
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {
        "settings", "providers", "credentials", "data_jobs", "data_coverage", "logs", "schema_migrations"
    } <= tables


def test_credentials_has_no_plaintext_token_column(tmp_path):
    con = _apply(tmp_path)
    cols = {r[1] for r in con.execute("PRAGMA table_info(credentials)")}
    # 红线:绝无任何可存明文的列。
    assert not (cols & {"token", "secret", "password", "plaintext", "apikey", "api_key"})
    assert {"key_ref", "keyring_ref", "cipher", "nonce", "tag", "fingerprint"} <= cols


def test_data_jobs_status_check_enforced(tmp_path):
    con = _apply(tmp_path)
    con.execute(
        "INSERT INTO data_jobs(id,type,status,trigger,created_at,updated_at) "
        "VALUES('j1','cache_build','queued','onboarding','t','t')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO data_jobs(id,type,status,trigger,created_at,updated_at) "
            "VALUES('j2','cache_build','bogus','onboarding','t','t')"
        )


def test_data_coverage_composite_pk(tmp_path):
    con = _apply(tmp_path)
    con.execute(
        "INSERT INTO data_coverage(stock_code,dataset,provider,last_date,updated_at) "
        "VALUES('600519.SH','price','tushare','2024-01-01','t')"
    )
    with pytest.raises(sqlite3.IntegrityError):
        con.execute(
            "INSERT INTO data_coverage(stock_code,dataset,provider,last_date,updated_at) "
            "VALUES('600519.SH','price','akshare','2024-01-02','t')"
        )
    # 不同 dataset 同股可共存
    con.execute(
        "INSERT INTO data_coverage(stock_code,dataset,provider,last_date,updated_at) "
        "VALUES('600519.SH','daily_basic','tushare','2024-01-02','t')"
    )
