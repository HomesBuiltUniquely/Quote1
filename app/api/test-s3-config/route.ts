import { NextResponse } from "next/server";
import { S3Client, ListBucketsCommand, HeadBucketCommand } from "@aws-sdk/client-s3";

export const runtime = "nodejs";

export async function GET() {
  try {
    // Check environment variables
    const bucketName = process.env.AWS_S3_BUCKET_NAME;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.AWS_REGION || "us-east-1";

    const config = {
      hasBucketName: !!bucketName,
      bucketName: bucketName || "NOT SET",
      hasAccessKey: !!accessKeyId,
      accessKeyPrefix: accessKeyId ? accessKeyId.substring(0, 4) + "***" : "NOT SET",
      hasSecretKey: !!secretAccessKey,
      region: region,
    };

    if (!bucketName || !accessKeyId || !secretAccessKey) {
      return NextResponse.json({
        success: false,
        config,
        error: "Missing environment variables",
        message: "Please set AWS_S3_BUCKET_NAME, AWS_ACCESS_KEY_ID, and AWS_SECRET_ACCESS_KEY in .env.local",
      });
    }

    // Try to create S3 client and test connection
    const s3Client = new S3Client({
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    // Test 1: List buckets (tests credentials)
    let listBucketsResult;
    try {
      listBucketsResult = await s3Client.send(new ListBucketsCommand({}));
    } catch (error: unknown) {
      return NextResponse.json({
        success: false,
        config,
        error: "Failed to authenticate with AWS",
        message: error instanceof Error ? error.message : "Unknown error",
        suggestion: "Verify your AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are correct",
      });
    }

    // Test 2: Check if bucket exists and is accessible
    let bucketAccessible = false;
    let bucketError: string | undefined;
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
      bucketAccessible = true;
    } catch (error: unknown) {
      bucketError = error instanceof Error ? error.message : "Unknown error";
      if (error && typeof error === 'object' && '$metadata' in error) {
        const metadata = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
        if (metadata?.httpStatusCode === 403) {
          bucketError = "403 Forbidden - Bucket exists but access is denied. Check bucket policy and IAM permissions.";
        } else if (metadata?.httpStatusCode === 404) {
          bucketError = "404 Not Found - Bucket doesn't exist or wrong region.";
        }
      }
    }

    return NextResponse.json({
      success: bucketAccessible,
      config: {
        ...config,
        bucketName: bucketName, // Show full name now that we know it's set
      },
      awsConnection: {
        authenticated: true,
        accountId: listBucketsResult.Owner?.ID || "Unknown",
        bucketsFound: listBucketsResult.Buckets?.length || 0,
        bucketNames: listBucketsResult.Buckets?.map(b => b.Name) || [],
      },
      bucketTest: {
        accessible: bucketAccessible,
        error: bucketError,
        bucketName: bucketName,
        region: region,
      },
      recommendations: bucketAccessible ? [] : [
        "1. Verify the bucket name is correct (case-sensitive)",
        "2. Verify the region matches the bucket's actual region",
        "3. Check the bucket policy - it might be blocking access even with IAM permissions",
        "4. Ensure the IAM user has 's3:ListBucket' permission for the bucket",
        "5. Check if the bucket exists in the specified region",
      ],
    });
  } catch (error: unknown) {
    return NextResponse.json({
      success: false,
      error: "Unexpected error",
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
