# Protocol fixtures

`manifests.json` is copied byte-for-byte from
[mushuanli/fs-agent](https://github.com/mushuanli/fs-agent/blob/aca40cecdc998773a8836f2149e82b18969505ab/tests/sync/fixtures/manifests.json),
commit `aca40cecdc998773a8836f2149e82b18969505ab`.

The canonical JSON and SHA-256 pairs are protocol compatibility evidence.
When changing the wire format, update both repositories deliberately and retain
compatible fixture versions. Tests do not read a sibling server checkout.
