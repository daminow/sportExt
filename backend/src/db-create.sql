CREATE TABLE keys (
    id SERIAL PRIMARY KEY,
    code VARCHAR(255) NOT NULL UNIQUE,
    active BOOLEAN NOT NULL DEFAULT true,
    expiry_date TIMESTAMP NOT NULL
);