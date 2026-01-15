import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const runtime = "nodejs";

// Validate environment variables
const getS3Client = () => {
  const region = process.env.AWS_REGION || "us-east-1";
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

  if (!accessKeyId || !secretAccessKey) {
    throw new Error("AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env.local");
  }

  return new S3Client({
    region,
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  });
};

export async function POST(request: Request) {
  try {
    // Validate environment variables first
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    if (!bucketName) {
      return NextResponse.json(
        { 
          error: "S3 bucket name not configured",
          details: "Please set AWS_S3_BUCKET_NAME in your .env.local file. See S3_SETUP_GUIDE.md for instructions."
        },
        { status: 500 }
      );
    }

    // Validate AWS credentials
    let s3Client;
    try {
      s3Client = getS3Client();
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "AWS credentials not configured",
          details: "Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in your .env.local file. See S3_SETUP_GUIDE.md for instructions."
        },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const fileName = formData.get("fileName") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Generate a unique file name with timestamp
    const timestamp = Date.now();
    const sanitizedFileName = fileName
      ? fileName.replace(/[^a-zA-Z0-9.-]/g, "_")
      : "quote";
    const s3Key = `pdfs/${sanitizedFileName}_${timestamp}.pdf`;

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Upload to S3
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
      Body: buffer,
      ContentType: "application/pdf",
    });

    await s3Client.send(command);

    // Generate a signed URL (works for both public and private buckets)
    // Signed URLs are valid for 7 days by default
    const expiresIn = 7 * 24 * 60 * 60; // 7 days in seconds
    const getObjectCommand = new GetObjectCommand({
      Bucket: bucketName,
      Key: s3Key,
    });

    const s3Url = await getSignedUrl(s3Client, getObjectCommand, {
      expiresIn,
    });

    return NextResponse.json({
      success: true,
      url: s3Url,
      key: s3Key,
      expiresIn: expiresIn,
    });
  } catch (error) {
    console.error("S3 upload error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to upload file to S3",
      },
      { status: 500 }
    );
  }
}

