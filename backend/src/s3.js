const crypto = require('crypto');
const path = require('path');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const config = require('./config');

const client = new S3Client({
  region: config.s3.region,
  credentials: {
    accessKeyId: config.s3.accessKeyId,
    secretAccessKey: config.s3.secretAccessKey,
  },
});

function safeName(original) {
  const ext = path.extname(original || '').slice(0, 12);
  const base = path
    .basename(original || 'file', ext)
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .slice(0, 60);
  const rand = crypto.randomBytes(6).toString('hex');
  return `${Date.now()}-${rand}-${base}${ext}`;
}

// Uploads a buffer and returns { key, url }.
async function uploadBuffer(buffer, originalName, mimeType, subfolder = '') {
  const key = `${config.s3.prefix}${subfolder ? subfolder.replace(/\/$/, '') + '/' : ''}${safeName(
    originalName
  )}`;
  const params = {
    Bucket: config.s3.bucket,
    Key: key,
    Body: buffer,
    ContentType: mimeType || 'application/octet-stream',
  };
  if (config.s3.acl) params.ACL = config.s3.acl;
  await client.send(new PutObjectCommand(params));

  const url = config.s3.publicBase
    ? `${config.s3.publicBase.replace(/\/$/, '')}/${key}`
    : `https://${config.s3.bucket}.s3.${config.s3.region}.amazonaws.com/${key}`;
  return { key, url };
}

// For private buckets: generate a temporary signed URL.
async function signedUrlFor(key, expiresIn = 3600) {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }), {
    expiresIn,
  });
}

// Derive the S3 object key from a stored public URL (works for either URL format).
function keyFromUrl(url) {
  if (!url) return null;
  const i = url.indexOf(config.s3.prefix);
  if (i >= 0) return url.slice(i);
  try {
    const p = new URL(url).pathname.replace(/^\/+/, '');
    return p.startsWith(config.s3.bucket + '/') ? p.slice(config.s3.bucket.length + 1) : p;
  } catch {
    return null;
  }
}

// Returns a readable stream for an object (used to zip files).
async function getObjectStream(key) {
  const res = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  return res.Body;
}

module.exports = { uploadBuffer, signedUrlFor, keyFromUrl, getObjectStream };
