import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// In-memory storage for chunks
// Note: This works within the same function instance. For production with multiple instances,
// use Vercel Blob, Redis, or a database for shared storage
const chunkStorage = new Map<string, { chunks: Map<number, ArrayBuffer>; totalChunks: number; fileName: string; timestamp: number }>();

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const chunk = formData.get("chunk") as File;
    const chunkIndex = parseInt(formData.get("chunkIndex") as string);
    const totalChunks = parseInt(formData.get("totalChunks") as string);
    const uploadId = formData.get("uploadId") as string;
    const fileName = formData.get("fileName") as string;

    if (!chunk || chunkIndex === undefined || totalChunks === undefined || !uploadId) {
      return NextResponse.json(
        { error: "Missing required chunk data" },
        { status: 400 }
      );
    }

    // Get or create chunk storage for this upload
    if (!chunkStorage.has(uploadId)) {
      chunkStorage.set(uploadId, {
        chunks: new Map(),
        totalChunks,
        fileName: fileName || "upload.xlsx",
        timestamp: Date.now(),
      });
    }

    const upload = chunkStorage.get(uploadId)!;
    const chunkBuffer = await chunk.arrayBuffer();
    upload.chunks.set(chunkIndex, chunkBuffer);

    // Check if all chunks are received
    if (upload.chunks.size === totalChunks) {
      // Reassemble the file
      const chunks = Array.from({ length: totalChunks }, (_, i) => upload.chunks.get(i)!);
      const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
      const reassembled = new Uint8Array(totalSize);
      
      let offset = 0;
      for (const chunk of chunks) {
        reassembled.set(new Uint8Array(chunk), offset);
        offset += chunk.byteLength;
      }

      // Store the complete file
      upload.chunks.clear();
      upload.chunks.set(-1, reassembled.buffer); // Use -1 as key for complete file

      return NextResponse.json({
        success: true,
        uploadId,
        complete: true,
        message: "File upload complete",
      });
    }

    return NextResponse.json({
      success: true,
      uploadId,
      complete: false,
      received: upload.chunks.size,
      total: totalChunks,
    });
  } catch (error) {
    console.error("Error handling chunk upload:", error);
    return NextResponse.json(
      { error: "Failed to process chunk upload" },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const uploadId = searchParams.get("uploadId");

    if (!uploadId) {
      return NextResponse.json(
        { error: "Missing uploadId" },
        { status: 400 }
      );
    }

    const upload = chunkStorage.get(uploadId);
    if (!upload) {
      return NextResponse.json(
        { error: "Upload not found" },
        { status: 404 }
      );
    }

    const completeFile = upload.chunks.get(-1);
    if (!completeFile) {
      return NextResponse.json({
        complete: false,
        received: upload.chunks.size,
        total: upload.totalChunks,
      });
    }

    // Return the complete file
    return new NextResponse(completeFile, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${upload.fileName}"`,
      },
    });
  } catch (error) {
    console.error("Error retrieving file:", error);
    return NextResponse.json(
      { error: "Failed to retrieve file" },
      { status: 500 }
    );
  }
}

// Cleanup old uploads (run periodically)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    // Clean up uploads older than 10 minutes
    for (const [uploadId, upload] of chunkStorage.entries()) {
      if (now - upload.timestamp > 10 * 60 * 1000) {
        chunkStorage.delete(uploadId);
      }
    }
  }, 5 * 60 * 1000); // Check every 5 minutes
}

