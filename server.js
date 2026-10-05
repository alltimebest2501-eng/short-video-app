const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;

const uploadDir = path.join(__dirname, "uploads");
const dataFile = path.join(__dirname, "videos.json");

fs.mkdirSync(uploadDir, { recursive: true });

if (!fs.existsSync(dataFile)) {
  fs.writeFileSync(dataFile, "[]");
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

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

function getVideos() {
  try {
    return JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    return [];
  }
}

function saveVideos(videos) {
  fs.writeFileSync(dataFile, JSON.stringify(videos, null, 2));
}

const storage = multer.diskStorage({
  destination: (_, __, cb) => {
    cb(null, uploadDir);
  },

  filename: (_, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();

    const name = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .substring(0, 70);

    cb(
      null,
      `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${name}${ext}`
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

    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error("Only video files are allowed"));
    }
  }
});

/*
GET VIDEOS
*/
app.get("/api/videos", (req, res) => {
  const videos = getVideos();

  videos.sort((a, b) => b.createdAt - a.createdAt);

  res.json(videos);
});

/*
MULTIPLE VIDEO UPLOAD
*/
app.post(
  "/api/upload",
  upload.array("videos", 200),
  (req, res) => {
    try {
      const videos = getVideos();

      const newVideos = req.files.map(file => ({
        id: crypto.randomUUID(),

        name: file.originalname,

        filename: file.filename,

        url:
          "/videos/" +
          encodeURIComponent(file.filename),

        size: file.size,

        createdAt: Date.now()
      }));

      videos.push(...newVideos);

      saveVideos(videos);

      res.json({
        success: true,
        count: newVideos.length,
        videos: newVideos
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
DELETE VIDEO
*/
app.delete("/api/videos/:id", (req, res) => {
  const videos = getVideos();

  const video = videos.find(
    v => v.id === req.params.id
  );

  if (!video) {
    return res.status(404).json({
      error: "Video not found"
    });
  }

  const filePath = path.join(
    uploadDir,
    video.filename
  );

  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {}

  const updated = videos.filter(
    v => v.id !== req.params.id
  );

  saveVideos(updated);

  res.json({
    success: true
  });
});

/*
START
*/
app.listen(PORT, () => {
  console.log(
    `Short Video App running on port ${PORT}`
  );
});
