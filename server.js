const express = require("express");
const {
  S3Client,
  ListBucketsCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const multer = require("multer");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

// ─────────────────────────────────────────────────────────────────────────────
// BUILD S3 CLIENT USING ONLY THE CREDENTIALS SUPPLIED BY THE BROWSER.
// The AWS SDK will NEVER fall back to env vars, ~/.aws/credentials,
// IAM instance role, or EC2 metadata — because we pass credentials: {}
// explicitly on every single call.
// ─────────────────────────────────────────────────────────────────────────────
function makeS3(ak, sk, region) {
  if (!ak || !sk) throw new Error("Access Key ID and Secret Access Key are required.");
  return new S3Client({
    region: region || "ap-south-1",
    credentials: {
      accessKeyId:     ak,
      secretAccessKey: sk,
    },
  });
}

// Pull credentials from query string (GET) or body (POST / DELETE)
function creds(req) {
  return {
    ak: (req.query.ak || req.body?.ak || "").trim(),
    sk: (req.query.sk || req.body?.sk || "").trim(),
  };
}

// Turn AWS errors into readable messages
function friendlyError(err) {
  const m = err.message || "";
  if (m.includes("InvalidAccessKeyId") || m.includes("InvalidClientTokenId"))
    return "Invalid Access Key ID — please check your credentials.";
  if (m.includes("SignatureDoesNotMatch"))
    return "Incorrect Secret Access Key — please check your credentials.";
  if (m.includes("AccessDenied") || m.includes("403"))
    return "Access denied — your key lacks the required S3 permissions.";
  if (m.includes("ExpiredToken") || m.includes("TokenExpired"))
    return "Token expired — please sign in again.";
  if (m.includes("NoSuchBucket"))
    return "Bucket not found — check name and region.";
  if (m.includes("NetworkingError") || m.includes("ENOTFOUND"))
    return "Network error — check your EC2 internet connectivity.";
  return m;
}

function guard(req, res) {
  const { ak, sk } = creds(req);
  if (!ak || !sk) {
    res.status(401).json({ error: "Access Key ID and Secret Access Key are required." });
    return null;
  }
  return { ak, sk };
}

// ─── HEALTH ──────────────────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

// ─── LIST BUCKETS  (validates credentials) ───────────────────────────────────
app.get("/api/buckets", async (req, res) => {
  const c = guard(req, res); if (!c) return;
  const region = req.query.region || "ap-south-1";
  try {
    const s3   = makeS3(c.ak, c.sk, region);
    const data = await s3.send(new ListBucketsCommand({}));
    res.json({ buckets: (data.Buckets || []).map((b) => b.Name) });
  } catch (err) {
    console.error("ListBuckets:", err.message);
    res.status(401).json({ error: friendlyError(err) });
  }
});

// ─── LIST OBJECTS IN A PREFIX ────────────────────────────────────────────────
app.get("/api/list", async (req, res) => {
  const c = guard(req, res); if (!c) return;
  const { bucket, prefix = "", region = "ap-south-1" } = req.query;
  if (!bucket) return res.status(400).json({ error: "bucket is required." });
  try {
    const s3   = makeS3(c.ak, c.sk, region);
    const data = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, Delimiter: "/" })
    );
    const folders = (data.CommonPrefixes || []).map((cp) => ({
      type: "folder", key: cp.Prefix,
      name: cp.Prefix.slice(prefix.length).replace(/\/$/, ""),
      size: null, modified: null,
    }));
    const files = (data.Contents || [])
      .filter((o) => o.Key !== prefix)
      .map((o) => ({
        type: "file", key: o.Key,
        name: o.Key.slice(prefix.length),
        size: o.Size, modified: o.LastModified,
      }));
    res.json({ folders, files, truncated: !!data.IsTruncated });
  } catch (err) {
    console.error("ListObjects:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// ─── SEARCH ACROSS ENTIRE BUCKET ─────────────────────────────────────────────
app.get("/api/search", async (req, res) => {
  const c = guard(req, res); if (!c) return;
  const { bucket, query, region = "ap-south-1" } = req.query;
  if (!bucket || !query) return res.status(400).json({ error: "bucket and query are required." });
  try {
    const s3 = makeS3(c.ak, c.sk, region);
    const results = [];
    let token;
    do {
      const data = await s3.send(
        new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
      );
      (data.Contents || []).forEach((o) => {
        if (o.Key.toLowerCase().includes(query.toLowerCase())) {
          results.push({ type: "file", key: o.Key, name: o.Key, size: o.Size, modified: o.LastModified });
        }
      });
      token = data.IsTruncated ? data.NextContinuationToken : null;
    } while (token && results.length < 500);
    res.json({ results });
  } catch (err) {
    console.error("Search:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// ─── PRE-SIGNED DOWNLOAD URL (10 min) ────────────────────────────────────────
app.get("/api/download-url", async (req, res) => {
  const c = guard(req, res); if (!c) return;
  const { bucket, key, region = "ap-south-1" } = req.query;
  if (!bucket || !key) return res.status(400).json({ error: "bucket and key are required." });
  try {
    const s3  = makeS3(c.ak, c.sk, region);
    const url = await getSignedUrl(
      s3, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 600 }
    );
    res.json({ url });
  } catch (err) {
    console.error("DownloadURL:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// ─── UPLOAD FILE ─────────────────────────────────────────────────────────────
app.post("/api/upload", upload.single("file"), async (req, res) => {
  const ak = (req.body?.ak || "").trim();
  const sk = (req.body?.sk || "").trim();
  if (!ak || !sk) return res.status(401).json({ error: "Credentials missing." });
  const { bucket, prefix = "", region = "ap-south-1" } = req.body;
  if (!bucket)   return res.status(400).json({ error: "bucket is required." });
  if (!req.file) return res.status(400).json({ error: "No file provided." });
  try {
    const s3  = makeS3(ak, sk, region);
    const key = prefix + req.file.originalname;
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: key,
      Body: req.file.buffer, ContentType: req.file.mimetype,
    }));
    res.json({ success: true, key });
  } catch (err) {
    console.error("Upload:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// ─── DELETE FILE ─────────────────────────────────────────────────────────────
app.delete("/api/delete", async (req, res) => {
  const { ak = "", sk = "", bucket, key, region = "ap-south-1" } = req.body;
  if (!ak.trim() || !sk.trim()) return res.status(401).json({ error: "Credentials missing." });
  if (!bucket || !key)          return res.status(400).json({ error: "bucket and key are required." });
  try {
    const s3 = makeS3(ak.trim(), sk.trim(), region);
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    res.json({ success: true });
  } catch (err) {
    console.error("Delete:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});

// ─── SERVE FRONTEND ───────────────────────────────────────────────────────────
app.get("*", (_req, res) =>
  res.sendFile(path.join(__dirname, "public", "index.html"))
);

// ─── START ────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`\n✅  S3 Panda → http://0.0.0.0:${PORT}`);
  console.log(`    Mode: browser-supplied credentials ONLY`);
  console.log(`    IAM roles / aws configure / env vars are IGNORED\n`);
});
