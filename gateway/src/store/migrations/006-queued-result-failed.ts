export default `ALTER TABLE queued_calls ADD COLUMN result_failed INTEGER CHECK(result_failed IN (0,1));`;
