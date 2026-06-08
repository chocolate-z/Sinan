"""SQL CHECK 枚举 ↔ 契约 一致性(防漂移护栏)。

SQL CHECK 约束无法 import 常量,只能硬编码枚举字符串。此测试解析 0001_init.sql 的
每个 CHECK (col IN (...)),断言每个契约枚举的取值集合都被某个 CHECK 完整反映 ——
契约枚举一旦增减取值而 SQL 未同步,此测试即失败,提示更新迁移。
"""

import re
from pathlib import Path

from sinan_contracts.enums import ENUM_MIRROR

_MIGRATIONS_DIR = (
    Path(__file__).resolve().parents[3] / "services" / "api" / "src" / "db" / "migrations"
)

# CHECK (col IN ('a', 'b', ...))
_CHECK_RE = re.compile(r"CHECK\s*\(\s*\w+\s+IN\s*\(([^)]*)\)\s*\)", re.IGNORECASE)


def _check_value_sets() -> list[frozenset[str]]:
    sets = []
    for sql_file in sorted(_MIGRATIONS_DIR.glob("*.sql")):
        sql = sql_file.read_text(encoding="utf-8")
        for group in _CHECK_RE.findall(sql):
            values = re.findall(r"'([^']*)'", group)
            sets.append(frozenset(values))
    return sets


# 迁移中受契约管辖的枚举(key_ref/kind/status 等内部枚举不在契约,故不校验)。
_CONTRACT_ENUMS_IN_SQL = [
    "ProviderStatus", "JobType", "JobStatus", "JobTrigger", "Dataset", "LogLevel",
    "Portfolio", "SignalAction", "TradeSide", "TradeReason",
]


def test_each_contract_enum_reflected_by_a_sql_check():
    check_sets = _check_value_sets()
    assert check_sets, "未在迁移中解析到任何 CHECK ... IN 枚举"
    for name in _CONTRACT_ENUMS_IN_SQL:
        expected = frozenset(ENUM_MIRROR[name])
        assert expected in check_sets, (
            f"契约枚举 {name}={sorted(expected)} 未被任何 SQL CHECK 完整反映;"
            f"请同步 0001_init.sql。当前 CHECK 集合:{[sorted(s) for s in check_sets]}"
        )


def test_no_orphan_status_like_check_drift():
    # 冗余哨兵:JobStatus 必含 'paused'(断点续传暂停态),防 SQL 漏配。
    check_sets = _check_value_sets()
    assert any("paused" in s and "queued" in s for s in check_sets)
