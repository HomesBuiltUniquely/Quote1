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
    throw new Error("AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables");
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
          details: "Please set AWS_S3_BUCKET_NAME environment variable. In production (Vercel), add it in Project Settings > Environment Variables."
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
          details: "Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables. In production (Vercel), add them in Project Settings > Environment Variables."
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
  } catch (error: unknown) {
    console.error("S3 upload error:", error);
    
    // Provide more detailed error information
    let errorMessage = "Failed to upload file to S3";
    let errorDetails = "";
    let statusCode = 500;
    
    // Handle AWS SDK errors
    if (error && typeof error === 'object' && 'name' in error) {
      const awsError = error as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
      
      // Check HTTP status code from AWS
      if (awsError.$metadata?.httpStatusCode === 403) {
        statusCode = 403;
        errorMessage = "Access Denied (403 Forbidden)";
        errorDetails = "IAM user lacks required permissions. Ensure the user has 'PutObject' and 'GetObject' permissions for the bucket. See FIX_403_ERROR.md for instructions.";
      } else if (awsError.$metadata?.httpStatusCode === 404) {
        statusCode = 404;
        errorMessage = "Bucket Not Found (404)";
        errorDetails = "Bucket not found - verify bucket name and region are correct";
      }
      
      // Check error name/code
      if (awsError.name === "AccessDenied" || awsError.name === "Forbidden") {
        statusCode = 403;
        errorMessage = "Access Denied";
        errorDetails = "IAM user lacks required permissions. Ensure the user has 'PutObject' and 'GetObject' permissions. See FIX_403_ERROR.md for instructions.";
      } else if (awsError.name === "NoSuchBucket") {
        statusCode = 404;
        errorMessage = "Bucket Not Found";
        errorDetails = "Bucket not found - verify bucket name and region are correct";
      } else if (awsError.name === "InvalidAccessKeyId" || awsError.name === "SignatureDoesNotMatch") {
        statusCode = 401;
        errorMessage = "Invalid AWS Credentials";
        errorDetails = "Invalid AWS credentials - verify Access Key ID and Secret Access Key in Vercel environment variables";
      }
    } else if (error instanceof Error) {
      errorMessage = error.message;
      
      // Check for common AWS errors in message
      if (error.message.includes("Access Denied") || error.message.includes("403") || error.message.includes("Forbidden")) {
        statusCode = 403;
        errorDetails = "Check IAM permissions - user needs PutObject and GetObject permissions. See FIX_403_ERROR.md";
      } else if (error.message.includes("NoSuchBucket") || error.message.includes("404")) {
        statusCode = 404;
        errorDetails = "Bucket not found - verify bucket name and region are correct";
      } else if (error.message.includes("InvalidAccessKeyId") || error.message.includes("SignatureDoesNotMatch")) {
        statusCode = 401;
        errorDetails = "Invalid AWS credentials - verify Access Key ID and Secret Access Key";
      } else if (error.message.includes("timeout") || error.message.includes("ECONNRESET")) {
        errorDetails = "Network timeout - check Vercel function timeout settings";
      }
    }
    
    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails || "Check server logs for more details",
        timestamp: new Date().toISOString(),
        ...(error && typeof error === 'object' && 'name' in error ? { errorCode: (error as { name?: string }).name } : {}),
      },
      { status: statusCode }
    );
  }
}

