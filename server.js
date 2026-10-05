const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const uploadDir = path.join(__dirname, "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.use(
  "/videos",
  express.static(uploadDir, {
    setHeaders(res) {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader(
        "Cache-Control",
        "public, max-age=31536000, immutable"
      );
    }
  })
);

/*
==================================================
DATABASE
==================================================
Render PostgreSQL recommended.

Add DATABASE_URL in Render Environment.
*/

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
      rejectUnauthorized: false
    }
  });
}

async function dbQuery(text, params = []) {
  if (!pool) {
    throw new Error("DATABASE_URL is not configured");
  }

  return pool.query(text, params);
}

/*
==================================================
DATABASE SETUP
==================================================
*/

async function setupDatabase() {
  if (!pool) {
    console.log("DATABASE_URL not configured.");
    return;
  }

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL,
      url TEXT NOT NULL,
      size BIGINT DEFAULT 0,
      is_premium BOOLEAN DEFAULT FALSE,
      views INTEGER DEFAULT 0,
      likes INTEGER DEFAULT 0,
      comments INTEGER DEFAULT 0,
      shares INTEGER DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      video_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      comment TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      telegram_id TEXT UNIQUE,
      name TEXT,
      premium_until BIGINT DEFAULT 0,
      created_at BIGINT NOT NULL
    )
  `);

  await dbQuery(`
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      telegram_id TEXT,
      amount INTEGER NOT NULL,
      currency TEXT DEFAULT 'INR',
      status TEXT DEFAULT 'pending',
      telegram_payment_id TEXT,
      created_at BIGINT NOT NULL
    )
  `);

  console.log("Database ready.");
}

/*
==================================================
UPLOAD
==================================================
*/

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, uploadDir);
  },

  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    const cleanName = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .substring(0, 70);

    cb(
      null,
      `${Date.now()}-${crypto
        .randomBytes(5)
        .toString("hex")}-${cleanName}${ext}`
    );
  }
});

const upload = multer({
  storage,

  limits: {
    fileSize: 2 * 1024 * 1024 * 1024
  },

  fileFilter: (_, file, cb) => {
    const allowed = [
      ".mp4",
      ".webm",
      ".mov",
      ".m4v"
    ];

    const ext = path.extname(file.originalname).toLowerCase();

    cb(null, allowed.includes(ext));
  }
});

/*
==================================================
GET VIDEOS
==================================================
*/

app.get("/api/videos", async (req, res) => {
  try {
    const result = await dbQuery(`
      SELECT
        id,
        name,
        url,
        size,
        is_premium,
        views,
        likes,
        comments,
        shares,
        created_at
      FROM videos
      ORDER BY created_at DESC
    `);

    res.json(result.rows);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Database unavailable"
    });
  }
});

/*
==================================================
UPLOAD MULTIPLE VIDEOS
==================================================
*/

app.post(
  "/api/upload",
  upload.array("videos", 200),
  async (req, res) => {
    try {
      const premium =
        req.body.premium === "true";

      const uploaded = [];

      for (const file of req.files || []) {

        const id = crypto.randomUUID();

        const url =
          "/videos/" +
          encodeURIComponent(file.filename);

        await dbQuery(
          `
          INSERT INTO videos
          (
            id,
            name,
            filename,
            url,
            size,
            is_premium,
            created_at
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            id,
            file.originalname,
            file.filename,
            url,
            file.size,
            premium,
            Date.now()
          ]
        );

        uploaded.push({
          id,
          name: file.originalname,
          url,
          is_premium: premium
        });
      }

      res.json({
        success: true,
        count: uploaded.length,
        videos: uploaded
      });

    } catch (error) {
      console.error(error);

      res.status(500).json({
        success: false,
        error: "Upload failed"
      });
    }
  }
);

/*
==================================================
VIEW
==================================================
*/

app.post("/api/videos/:id/view", async (req, res) => {

  try {

    await dbQuery(
      `
      UPDATE videos
      SET views = views + 1
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({ success: true });

  } catch {
    res.status(500).json({
      error: "Unable to update view"
    });
  }

});

/*
==================================================
LIKE
==================================================
*/

app.post("/api/videos/:id/like", async (req, res) => {

  try {

    await dbQuery(
      `
      UPDATE videos
      SET likes = likes + 1
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({ success: true });

  } catch {

    res.status(500).json({
      error: "Unable to like"
    });

  }

});

/*
==================================================
SHARE
==================================================
*/

app.post("/api/videos/:id/share", async (req, res) => {

  try {

    await dbQuery(
      `
      UPDATE videos
      SET shares = shares + 1
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({
      success: true
    });

  } catch {

    res.status(500).json({
      error: "Unable to share"
    });

  }

});

/*
==================================================
COMMENTS
==================================================
*/

app.get("/api/videos/:id/comments", async (req, res) => {

  try {

    const result = await dbQuery(
      `
      SELECT
        id,
        user_name,
        comment,
        created_at
      FROM comments
      WHERE video_id = $1
      ORDER BY created_at DESC
      `,
      [req.params.id]
    );

    res.json(result.rows);

  } catch {

    res.status(500).json({
      error: "Unable to load comments"
    });

  }

});


app.post("/api/videos/:id/comments", async (req, res) => {

  const userName =
    String(req.body.userName || "Guest")
      .substring(0, 50);

  const comment =
    String(req.body.comment || "")
      .trim()
      .substring(0, 500);

  if (!comment) {
    return res.status(400).json({
      error: "Comment required"
    });
  }

  try {

    const id = crypto.randomUUID();

    await dbQuery(
      `
      INSERT INTO comments
      (
        id,
        video_id,
        user_name,
        comment,
        created_at
      )
      VALUES ($1,$2,$3,$4,$5)
      `,
      [
        id,
        req.params.id,
        userName,
        comment,
        Date.now()
      ]
    );

    await dbQuery(
      `
      UPDATE videos
      SET comments = comments + 1
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({
      success: true
    });

  } catch {

    res.status(500).json({
      error: "Unable to add comment"
    });

  }

});

/*
==================================================
DELETE VIDEO
==================================================
*/

app.delete("/api/videos/:id", async (req, res) => {

  try {

    const result = await dbQuery(
      `
      SELECT filename
      FROM videos
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (!result.rows.length) {

      return res.status(404).json({
        error: "Video not found"
      });

    }

    const filename =
      result.rows[0].filename;

    const filePath =
      path.join(uploadDir, filename);

    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    await dbQuery(
      `
      DELETE FROM comments
      WHERE video_id = $1
      `,
      [req.params.id]
    );

    await dbQuery(
      `
      DELETE FROM videos
      WHERE id = $1
      `,
      [req.params.id]
    );

    res.json({
      success: true
    });

  } catch (error) {

    console.error(error);

    res.status(500).json({
      error: "Delete failed"
    });

  }

});

/*
==================================================
PREMIUM STATUS
==================================================
*/

app.get("/api/premium/:telegramId", async (req, res) => {

  try {

    const result = await dbQuery(
      `
      SELECT premium_until
      FROM users
      WHERE telegram_id = $1
      `,
      [req.params.telegramId]
    );

    if (!result.rows.length) {

      return res.json({
        premium: false
      });

    }

    const premiumUntil =
      Number(result.rows[0].premium_until || 0);

    res.json({
      premium: premiumUntil > Date.now(),
      premiumUntil
    });

  } catch {

    res.status(500).json({
      error: "Unable to check premium"
    });

  }

});

/*
==================================================
TELEGRAM BOT PAYMENT
==================================================

Payment processing is intentionally kept behind
server-side secrets.

Set:

TELEGRAM_BOT_TOKEN
PAYMENT_PROVIDER_TOKEN

after choosing a supported Telegram payment provider.

The actual payment confirmation must come from
Telegram's successful_payment update before
premium is activated.
==================================================
*/

app.post("/api/telegram/webhook", async (req, res) => {

  try {

    const update = req.body;

    /*
    Telegram sends successful_payment after
    the payment is completed.
    */

    if (
      update.message &&
      update.message.successful_payment
    ) {

      const message =
        update.message;

      const telegramId =
        String(message.from.id);

      const payment =
        message.successful_payment;

      const paymentId =
        crypto.randomUUID();

      /*
      30 days premium
      */

      const premiumUntil =
        Date.now() +
        30 * 24 * 60 * 60 * 1000;

      await dbQuery(
        `
        INSERT INTO users
        (
          id,
          telegram_id,
          name,
          premium_until,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5)

        ON CONFLICT (telegram_id)
        DO UPDATE SET
          name = EXCLUDED.name,
          premium_until =
            GREATEST(
              users.premium_until,
              EXCLUDED.premium_until
            )
        `,
        [
          crypto.randomUUID(),
          telegramId,
          message.from.first_name || "Telegram User",
          premiumUntil,
          Date.now()
        ]
      );

      await dbQuery(
        `
        INSERT INTO payments
        (
          id,
          telegram_id,
          amount,
          currency,
          status,
          telegram_payment_id,
          created_at
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          paymentId,
          telegramId,
          Number(payment.total_amount),
          payment.currency,
          "paid",
          payment.telegram_payment_charge_id,
          Date.now()
        ]
      );

      console.log(
        "Premium activated for:",
        telegramId
      );
    }

    res.sendStatus(200);

  } catch (error) {

    console.error(
      "Telegram webhook error:",
      error
    );

    res.sendStatus(500);
  }

});

/*
==================================================
HEALTH
==================================================
*/

app.get("/api/health", (req, res) => {

  res.json({
    status: "online",
    app: "Short Video App",
    premiumPrice: 99
  });

});


/*
==================================================
START
==================================================
*/

setupDatabase()
  .then(() => {

    app.listen(PORT, () => {

      console.log(
        `Short Video App running on port ${PORT}`
      );

    });

  })
  .catch(error => {

    console.error(
      "Database startup error:",
      error
    );

    process.exit(1);

  });
