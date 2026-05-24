-- 2026-05-24: tabel untuk health-probe WebAPI BPS
-- Spec: docs/superpowers/specs/2026-05-24-webapi-bps-status-design.md §4.1
-- Run dengan: mysql -u <user> -p project_data_strategis < this_file.sql

CREATE TABLE IF NOT EXISTS webapi_health_logs (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  run_id          CHAR(36) NOT NULL,                          -- crypto.randomUUID()
  probe_kind      ENUM('scheduled','manual','recovery') NOT NULL,
  endpoint_family VARCHAR(32) NOT NULL,
  url_template    VARCHAR(255) NOT NULL,
  http_status     SMALLINT NULL,
  latency_ms      INT NULL,
  ok              TINYINT(1) NOT NULL,
  error_code      VARCHAR(64) NULL,
  error_message   VARCHAR(500) NULL,
  bytes_received  INT NULL,
  created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at),
  INDEX idx_family_created (endpoint_family, created_at),
  INDEX idx_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
