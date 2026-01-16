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

    // Log configuration (without sensitive data)
    console.log("S3 Upload Configuration:", {
      bucket: bucketName,
      region: process.env.AWS_REGION || "us-east-1",
      key: s3Key,
      hasAccessKey: !!process.env.AWS_ACCESS_KEY_ID,
      hasSecretKey: !!process.env.AWS_SECRET_ACCESS_KEY,
      accessKeyPrefix: process.env.AWS_ACCESS_KEY_ID?.substring(0, 4) + "***",
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
    // Log full error details for debugging
    console.error("S3 upload error - Full details:", {
      error,
      errorType: typeof error,
      errorName: error && typeof error === 'object' && 'name' in error ? (error as { name?: string }).name : undefined,
      errorMessage: error instanceof Error ? error.message : String(error),
      metadata: error && typeof error === 'object' && '$metadata' in error ? (error as { $metadata?: unknown }).$metadata : undefined,
      stack: error instanceof Error ? error.stack : undefined,
    });
    
    // Provide more detailed error information
    let errorMessage = "Failed to upload file to S3";
    let errorDetails = "";
    let statusCode = 500;
    let errorCode: string | undefined;
    
    // Handle AWS SDK errors - check for $metadata first (most reliable)
    if (error && typeof error === 'object') {
      const awsError = error as { 
        name?: string; 
        message?: string; 
        $metadata?: { httpStatusCode?: number; requestId?: string };
        Code?: string;
        $fault?: string;
      };
      
      // Check HTTP status code from AWS metadata (most reliable indicator)
      const httpStatusCode = awsError.$metadata?.httpStatusCode;
      if (httpStatusCode === 403) {
        statusCode = 403;
        errorMessage = "Access Denied (403 Forbidden)";
        errorDetails = `Your AWS IAM user/role doesn't have permission to upload to this S3 bucket. Possible causes: 1) IAM user needs 's3:PutObject' and 's3:GetObject' permissions, 2) Bucket policy is blocking access, 3) Wrong bucket name or region. Bucket: ${process.env.AWS_S3_BUCKET_NAME}, Region: ${process.env.AWS_REGION || "us-east-1"}`;
        errorCode = awsError.name || "AccessDenied";
      } else if (httpStatusCode === 404) {
        statusCode = 404;
        errorMessage = "Bucket Not Found (404)";
        errorDetails = `The S3 bucket was not found. Please verify the bucket name (AWS_S3_BUCKET_NAME=${process.env.AWS_S3_BUCKET_NAME}) and region (AWS_REGION=${process.env.AWS_REGION || "us-east-1"}) are correct.`;
        errorCode = awsError.name || "NoSuchBucket";
      } else if (httpStatusCode === 401) {
        statusCode = 401;
        errorMessage = "Invalid AWS Credentials";
        errorDetails = "Invalid AWS credentials. Please verify your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct and match the IAM user with S3 permissions.";
        errorCode = awsError.name || "InvalidAccessKeyId";
      }
      
      // Check error name/code (fallback if $metadata not available)
      if (statusCode === 500) {
        const errorName = awsError.name || awsError.Code;
        if (errorName === "AccessDenied" || errorName === "Forbidden" || errorName === "403") {
          statusCode = 403;
          errorMessage = "Access Denied";
          errorDetails = `Your AWS IAM user/role doesn't have permission to upload to this S3 bucket. Possible causes: 1) IAM user needs 's3:PutObject' and 's3:GetObject' permissions, 2) Bucket policy is blocking access, 3) Wrong bucket name or region. Bucket: ${process.env.AWS_S3_BUCKET_NAME}, Region: ${process.env.AWS_REGION || "us-east-1"}`;
          errorCode = errorName;
        } else if (errorName === "NoSuchBucket" || errorName === "404") {
          statusCode = 404;
          errorMessage = "Bucket Not Found";
          errorDetails = `The S3 bucket was not found. Please verify the bucket name (${process.env.AWS_S3_BUCKET_NAME}) and region (${process.env.AWS_REGION || "us-east-1"}) are correct.`;
          errorCode = errorName;
        } else if (errorName === "InvalidAccessKeyId" || errorName === "SignatureDoesNotMatch") {
          statusCode = 401;
          errorMessage = "Invalid AWS Credentials";
          errorDetails = "Invalid AWS credentials. Please verify your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct and match the IAM user with S3 permissions.";
          errorCode = errorName;
        }
      }
      
      // Store error code if available
      if (!errorCode && awsError.name) {
        errorCode = awsError.name;
      }
    }
    
    // Handle Error instances
    if (error instanceof Error && statusCode === 500) {
      errorMessage = error.message;
      
      // Check for common AWS errors in message
      if (error.message.includes("Access Denied") || error.message.includes("403") || error.message.includes("Forbidden")) {
        statusCode = 403;
        errorDetails = "Your AWS IAM user/role doesn't have permission to upload to this S3 bucket. The IAM user needs 's3:PutObject' and 's3:GetObject' permissions for the bucket.";
      } else if (error.message.includes("NoSuchBucket") || error.message.includes("404")) {
        statusCode = 404;
        errorDetails = "The S3 bucket was not found. Please verify the bucket name and region are correct.";
      } else if (error.message.includes("InvalidAccessKeyId") || error.message.includes("SignatureDoesNotMatch")) {
        statusCode = 401;
        errorDetails = "Invalid AWS credentials. Please verify your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct.";
      } else if (error.message.includes("timeout") || error.message.includes("ECONNRESET")) {
        errorDetails = "Network timeout - check your network connection and Vercel function timeout settings";
      }
    }
    
    // Always return a valid JSON response
    return NextResponse.json(
      {
        error: errorMessage,
        details: errorDetails || "An unexpected error occurred. Check server logs for more details.",
        timestamp: new Date().toISOString(),
        ...(errorCode ? { errorCode } : {}),
      },
      { 
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );
  }
}

