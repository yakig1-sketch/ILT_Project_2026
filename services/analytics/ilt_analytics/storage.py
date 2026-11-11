"""The private exports bucket in the S3 storage (SeaweedFS)."""

from __future__ import annotations

from pathlib import Path

import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from .config import s3_settings
from .exports import BUCKET


class ExportStore:
    def __init__(self) -> None:
        cfg = s3_settings()
        self.s3 = boto3.client(
            "s3", endpoint_url=cfg["endpoint"], aws_access_key_id=cfg["access_key"], aws_secret_access_key=cfg["secret_key"],
            region_name="us-east-1", config=Config(s3={"addressing_style": "path"}, connect_timeout=5, retries={"max_attempts": 2}),
        )
        self._bucket_ready = False

    def _ensure_bucket(self) -> None:
        if self._bucket_ready:
            return
        try:
            self.s3.head_bucket(Bucket=BUCKET)
        except ClientError:
            # Private: no bucket policy, so only the service identity can read it.
            self.s3.create_bucket(Bucket=BUCKET)
        self._bucket_ready = True

    def upload(self, path: Path, key: str) -> None:
        self._ensure_bucket()
        self.s3.upload_file(str(path), BUCKET, key, ExtraArgs={"ContentType": "application/zip"})
