// Teszt-környezet kényszerítése — MINDEN worker-ben, MINDEN import előtt fut.
//
// A DATABASE_URL-t feltétel nélkül a lokális teszt-Postgresre állítjuk:
// hiába van a backend/.env-ben a prod Neon connstring (a dotenv nem ír
// felül meglévő env-t), és hiába örökölne a shell bármit — teszt alatt
// kizárólag az embedded-postgres példányt érhetjük el.
process.env.DATABASE_URL = 'postgres://gofuvar:gofuvar@127.0.0.1:54331/gofuvar_test';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'teszt-jwt-titok-nem-eles';
process.env.PORT = '0';

// Külső szolgáltatások: minden kulcsot törlünk, hogy a stub-módok éljenek
// (SMS/email/Barion/Sentry/Gemini csak logol, semmi nem megy ki).
delete process.env.SEEME_API_KEY;
delete process.env.RESEND_API_KEY;
delete process.env.BARION_POSKEY;
delete process.env.SENTRY_DSN;
delete process.env.GEMINI_API_KEY;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
