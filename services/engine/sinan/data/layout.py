"""列式缓存布局:parquet hive 分区(board + year),DuckDB 只读视图。

cache/<dataset>/board=<sh|sz|bj>/year=<YYYY>/part.parquet
分区键服务诚实评估:查询带 trade_date<=asof(或财务 ann_date<=asof),从存储层杜绝未来函数。
"""

from __future__ import annotations

from pathlib import Path

# 每个 dataset 的主键与日期列。财务类按 ann_date(公告日)做 PIT,非 end_date(报告期)。
DATASET_KEYS: dict[str, tuple[str, ...]] = {
    "price": ("stock_code", "trade_date"),
    "adj_factor": ("stock_code", "trade_date"),
    "daily_basic": ("stock_code", "trade_date"),
    "northbound": ("stock_code", "trade_date"),
    "index_ohlcv": ("stock_code", "trade_date"),
    "fundamental": ("stock_code", "end_date"),
    "fina_indicator": ("stock_code", "end_date"),
    "index_weight": ("index_code", "trade_date", "stock_code"),
    "sw_industry": ("stock_code", "in_date"),
    # 基金持仓(穿透):按 (基金, 报告期, 成分股, 披露日) 唯一 —— ann_date 进主键让同报告期的修订版都留住,
    # 不被去重抹掉(PIT 取「披露日<=T 的最近一期」需要看到各披露日)。
    "fund_portfolio": ("fund_code", "end_date", "stock_code", "ann_date"),
}

# 财务类:asof 取 ann_date<=T 的最新一期(根除「一季报4月底才公告」的泄漏)。
FINANCIAL_PIT: frozenset[str] = frozenset({"fundamental", "fina_indicator"})

# 各 dataset 的「可见日」列(asof 比较列)。
ASOF_DATE_COL: dict[str, str] = {
    "price": "trade_date",
    "adj_factor": "trade_date",
    "daily_basic": "trade_date",
    "northbound": "trade_date",
    "index_ohlcv": "trade_date",
    "index_weight": "trade_date",
    "fundamental": "ann_date",
    "fina_indicator": "ann_date",
    "sw_industry": "in_date",
    "fund_portfolio": "ann_date",  # PIT 按披露日(非报告期 end_date)切,根除「持仓已变但还没公告」泄漏
}


def dataset_dir(cache_root: Path, dataset: str) -> Path:
    return Path(cache_root) / dataset


def partition_dir(cache_root: Path, dataset: str, board: str, year: str | int) -> Path:
    return dataset_dir(cache_root, dataset) / f"board={board}" / f"year={year}"


def partition_file(cache_root: Path, dataset: str, board: str, year: str | int) -> Path:
    return partition_dir(cache_root, dataset, board, year) / "part.parquet"


def stock_file(cache_root: Path, dataset: str, board: str, year: str | int, code: str) -> Path:
    """分股文件:board=<b>/year=<y>/<code>.parquet。每股各占一文件,写入只动自身小文件
    (O(stock)),根除「共享 part.parquet 越写越大、写第 K 只重写含前 K 只的大文件」的 O(N²)。
    旧 part.parquet 仍可与之共存(读端按主键去重兼容)。"""
    return partition_dir(cache_root, dataset, board, year) / f"{code}.parquet"


def glob_for(cache_root: Path, dataset: str) -> str:
    """DuckDB read_parquet 的 glob(hive 分区)。"""
    return str(dataset_dir(cache_root, dataset) / "**" / "*.parquet")


def globs_for_years(cache_root: Path, dataset: str, years: list[str]) -> list[str]:
    """只覆盖指定 year 分区的 glob 列表(DuckDB read_parquet 接受 glob 列表)。

    用于「只需最近窗口」的查询(如行情快照)避免 glob 全库上万个分股 parquet 文件 ——
    全市场多年缓存里,打开文件本身是主耗时,按年裁剪可成倍提速。
    """
    d = dataset_dir(cache_root, dataset)
    return [str(d / "board=*" / f"year={y}" / "*.parquet") for y in years]


def available_years(cache_root: Path, dataset: str) -> list[str]:
    """该数据集磁盘上存在的 year 分区(升序;仅列目录,不读文件,O(分区数)极廉价)。"""
    d = dataset_dir(cache_root, dataset)
    if not d.exists():
        return []
    years: set[str] = set()
    for board_dir in d.glob("board=*"):
        for yd in board_dir.glob("year=*"):
            name = yd.name
            if name.startswith("year="):
                years.add(name.split("=", 1)[1])
    return sorted(years)


def has_any(cache_root: Path, dataset: str) -> bool:
    d = dataset_dir(cache_root, dataset)
    return d.exists() and any(d.rglob("*.parquet"))
