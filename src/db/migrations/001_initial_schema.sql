-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    full_name     TEXT    NOT NULL,
    password_hash TEXT    NOT NULL,
    role          TEXT    NOT NULL CHECK (role IN ('admin', 'cashier')),
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    last_login_at TEXT,
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ============================================================
-- MEDICINES
-- ============================================================
CREATE TABLE medicines (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    name          TEXT    NOT NULL,
    generic_name  TEXT,
    barcode       TEXT    UNIQUE,
    dosage_form   TEXT,
    strength      TEXT,
    description   TEXT,
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK (reorder_level >= 0),
    is_active     INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_medicines_name    ON medicines (name COLLATE NOCASE);
CREATE INDEX idx_medicines_generic ON medicines (generic_name COLLATE NOCASE);

-- ============================================================
-- INVENTORY BATCHES
-- ============================================================
CREATE TABLE inventory_batches (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    medicine_id       INTEGER NOT NULL REFERENCES medicines (id) ON DELETE RESTRICT,
    batch_number      TEXT    NOT NULL,
    expiry_date       TEXT    NOT NULL
                      CHECK (expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    purchase_cost     INTEGER NOT NULL CHECK (purchase_cost >= 0),
    selling_price     INTEGER NOT NULL CHECK (selling_price >= 0),
    quantity_received INTEGER NOT NULL CHECK (quantity_received > 0),
    quantity_on_hand  INTEGER NOT NULL CHECK (quantity_on_hand >= 0),
    received_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    notes             TEXT,
    UNIQUE (medicine_id, batch_number)
);

CREATE INDEX idx_batches_fefo
    ON inventory_batches (medicine_id, expiry_date)
    WHERE quantity_on_hand > 0;

CREATE INDEX idx_batches_expiry
    ON inventory_batches (expiry_date)
    WHERE quantity_on_hand > 0;

-- ============================================================
-- SALES
-- ============================================================
CREATE TABLE sales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no      TEXT    NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
    subtotal        INTEGER NOT NULL CHECK (subtotal >= 0),
    discount        INTEGER NOT NULL DEFAULT 0 CHECK (discount >= 0),
    total           INTEGER NOT NULL CHECK (total >= 0),
    amount_tendered INTEGER NOT NULL DEFAULT 0 CHECK (amount_tendered >= 0),
    payment_method  TEXT    NOT NULL DEFAULT 'cash'
                    CHECK (payment_method IN ('cash', 'card', 'mobile', 'other')),
    status          TEXT    NOT NULL DEFAULT 'completed'
                    CHECK (status IN ('completed', 'voided')),
    created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK (total = subtotal - discount)
);

CREATE INDEX idx_sales_created ON sales (created_at);
CREATE INDEX idx_sales_user    ON sales (user_id, created_at);

-- ============================================================
-- SALE ITEMS
-- ============================================================
CREATE TABLE sale_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id     INTEGER NOT NULL REFERENCES sales (id) ON DELETE CASCADE,
    batch_id    INTEGER NOT NULL REFERENCES inventory_batches (id) ON DELETE RESTRICT,
    quantity    INTEGER NOT NULL CHECK (quantity > 0),
    unit_price  INTEGER NOT NULL CHECK (unit_price >= 0),
    unit_cost   INTEGER NOT NULL CHECK (unit_cost >= 0),
    line_total  INTEGER NOT NULL CHECK (line_total = quantity * unit_price)
);

CREATE INDEX idx_sale_items_sale  ON sale_items (sale_id);
CREATE INDEX idx_sale_items_batch ON sale_items (batch_id);