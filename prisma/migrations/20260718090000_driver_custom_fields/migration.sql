-- Driver "เมนูเพิ่มช่องเก็บข้อมูล": admin-defined extra { label, value } fields.
ALTER TABLE "Driver" ADD COLUMN "customFields" JSONB;
