# Amazon S3 Setup Guide

Follow these steps to configure Amazon S3 for PDF uploads:

## Step 1: Create an AWS Account

1. Go to [AWS Console](https://aws.amazon.com/console/)
2. Sign up or sign in to your AWS account
3. Complete the registration process if you're new

## Step 2: Create an S3 Bucket

1. **Navigate to S3:**
   - In AWS Console, search for "S3" in the services search bar
   - Click on "S3" service

2. **Create a new bucket:**
   - Click "Create bucket" button
   - Enter a unique bucket name (e.g., `my-pdf-uploads-2024`)
   - **Important:** Bucket names must be globally unique across all AWS accounts
   - Select a region (e.g., `us-east-1`, `us-west-2`, etc.)
   - **Note the region name** - you'll need it for the environment variable

3. **Configure bucket settings:**
   - **Block Public Access:** 
     - ✅ **RECOMMENDED: Keep it checked** (Private bucket)
       - More secure - files are not publicly accessible
       - The app will generate **signed URLs** that work for 7 days
       - Links will work, but only for those who have the signed URL
       - Better for sensitive documents
       - **The bucket itself remains private** - no one can list or browse files
     - ⚠️ **Alternative: Uncheck it** (Allows public files)
       - **Important:** Unchecking this does NOT make your bucket public!
       - It only ALLOWS you to make individual files public if you want
       - The bucket itself (listing files) remains private
       - Only specific files with public URLs can be accessed
       - Anyone with a direct file URL can access that specific file
       - But they CANNOT browse/list other files in the bucket
       - Simpler URLs (no expiration), but less secure
   - **Versioning:** Optional, can leave disabled
   - **Default encryption:** Recommended to enable (SSE-S3 is fine)
   
   **Key Point:** Even with "Block all public access" unchecked:
   - ✅ The bucket itself is NOT publicly accessible
   - ✅ People cannot list or browse your files
   - ✅ Only files with direct URLs can be accessed
   - ✅ Each file URL must be known/shared to access it
   
   **Note:** The app now uses **signed URLs** by default, so it works with either setting. 
   Keeping "Block all public access" checked is more secure and recommended.

4. **Create the bucket:**
   - Click "Create bucket" at the bottom

## Step 3: Create IAM User and Access Keys

1. **Navigate to IAM:**
   - In AWS Console, search for "IAM"
   - Click on "IAM" service

2. **Create a new user:**
   - Click "Users" in the left sidebar
   - Click "Create user"
   - Enter a username (e.g., `pdf-upload-service`)
   - Click "Next"

3. **Attach permissions:**
   - Select "Attach policies directly"
   - Search for and select: **`AmazonS3FullAccess`** (or create a custom policy with PutObject and GetObject permissions for your specific bucket)
   - **Note:** GetObject permission is needed to generate signed URLs
   - Click "Next"
   - Click "Create user"

4. **Create Access Keys:**
   - Click on the user you just created
   - Go to "Security credentials" tab
   - Scroll to "Access keys" section
   - Click "Create access key"
   - Select "Application running outside AWS"
   - Click "Next"
   - Add a description (optional)
   - Click "Create access key"
   - **IMPORTANT:** Copy both:
     - **Access key ID** (starts with `AKIA...`)
     - **Secret access key** (click "Show" to reveal it)
   - **Save these immediately** - you won't be able to see the secret key again!

## Step 4: Configure Environment Variables

1. **Create `.env.local` file:**
   - In your project root (`Quote1` folder), create a file named `.env.local`
   - Add the following variables:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here
AWS_S3_BUCKET_NAME=your_bucket_name_here
```

2. **Replace the values:**
   - `AWS_REGION`: The region where you created your bucket (e.g., `us-east-1`, `us-west-2`)
   - `AWS_ACCESS_KEY_ID`: The access key ID you copied in Step 3
   - `AWS_SECRET_ACCESS_KEY`: The secret access key you copied in Step 3
   - `AWS_S3_BUCKET_NAME`: The bucket name you created in Step 2

## Step 5: Restart Your Development Server

After creating/updating `.env.local`:
1. Stop your Next.js server (Ctrl+C)
2. Start it again: `npm run dev`
3. Environment variables are loaded on server start

## Step 6: Test the Upload

1. Upload an Excel file and generate a preview
2. Click "Upload to S3" button
3. Check the S3 bucket in AWS Console to verify the file was uploaded

## Troubleshooting

### Error: "S3 bucket name not configured"
- Make sure `.env.local` exists in the `Quote1` folder
- Verify `AWS_S3_BUCKET_NAME` is set correctly
- Restart your dev server after creating/updating `.env.local`

### Error: "Access Denied" or "Invalid credentials"
- Verify your Access Key ID and Secret Access Key are correct
- Make sure the IAM user has S3 permissions
- Check that the bucket name matches exactly (case-sensitive)

### Error: "Bucket not found"
- Verify the bucket name is correct
- Check that the AWS_REGION matches the bucket's region
- Ensure the bucket exists in your AWS account

### Files uploaded but URL doesn't work
- If bucket is private, you need to enable public access or use signed URLs
- Check bucket permissions in S3 Console
- Verify the bucket policy allows public read access (if needed)

## Security Best Practices

1. **Never commit `.env.local` to Git** - it's already in `.gitignore`
2. **Use IAM policies with least privilege** - only grant S3 PutObject permission for the specific bucket
3. **Rotate access keys regularly**
4. **Use environment variables in production** (Vercel, AWS, etc.) instead of hardcoding

## Example Custom IAM Policy (More Secure)

Instead of `AmazonS3FullAccess`, you can create a custom policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:PutObjectAcl",
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::your-bucket-name/*"
    }
  ]
}
```

**Important:** 
- `PutObject` - needed to upload files
- `GetObject` - needed to generate signed URLs (required for private buckets)
- Replace `your-bucket-name` with your actual bucket name

