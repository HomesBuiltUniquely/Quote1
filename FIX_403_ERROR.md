# Fix 403 Forbidden Error - IAM Permissions Issue

## Problem
Getting `403 Forbidden` error means your IAM user doesn't have the required permissions to upload files to S3.

## Solution: Update IAM User Permissions

### Step 1: Go to AWS IAM Console

1. Go to [AWS Console](https://console.aws.amazon.com/)
2. Search for "IAM" in the services search bar
3. Click on "IAM" service

### Step 2: Find Your IAM User

1. Click **"Users"** in the left sidebar
2. Find the user you created for S3 uploads (the one with the access keys you're using)
3. Click on the username

### Step 3: Check Current Permissions

1. Click on the **"Permissions"** tab
2. Check what policies are attached
3. If you see `AmazonS3FullAccess`, it should work - but let's verify

### Step 4: Add Required Permissions

You have two options:

#### Option A: Use Full S3 Access (Easiest)

1. Click **"Add permissions"** → **"Attach policies directly"**
2. Search for `AmazonS3FullAccess`
3. Check the box next to it
4. Click **"Next"** → **"Add permissions"**

#### Option B: Custom Policy (More Secure - Recommended)

1. Click **"Add permissions"** → **"Create inline policy"**
2. Click on **"JSON"** tab
3. Paste this policy (replace `hubinterior-quote-2026` with your bucket name):

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
      "Resource": "arn:aws:s3:::hubinterior-quote-2026/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::hubinterior-quote-2026"
    }
  ]
}
```

4. Click **"Next"**
5. Give it a name: `S3UploadAccess`
6. Click **"Create policy"**

### Step 5: Verify Permissions

After adding permissions, your user should have:
- ✅ `s3:PutObject` - to upload files
- ✅ `s3:GetObject` - to generate signed URLs
- ✅ `s3:ListBucket` - to list bucket contents (optional but helpful)

### Step 6: Test Again

1. Wait 1-2 minutes for permissions to propagate
2. Try uploading to S3 again in your production app
3. The 403 error should be gone

## Common Issues

### Issue: Still getting 403 after adding permissions
**Solutions:**
- Wait a few minutes - AWS permissions can take time to propagate
- Double-check the bucket name in the policy matches exactly (case-sensitive)
- Verify you're using the correct IAM user's access keys
- Check if bucket policy is blocking access

### Issue: Bucket Policy Conflict
If your bucket has a bucket policy that denies access:
1. Go to S3 Console → Your bucket → **Permissions** tab
2. Check **Bucket policy**
3. Make sure it's not denying your IAM user
4. You may need to add your IAM user ARN to the bucket policy

### Issue: Wrong Region
Make sure:
- Your `AWS_REGION` environment variable matches the bucket's region
- Your bucket exists in that region
- Your IAM user has permissions in that region

## Quick Checklist

- [ ] IAM user has `PutObject` permission
- [ ] IAM user has `GetObject` permission  
- [ ] Bucket name in policy matches exactly
- [ ] Waited a few minutes after adding permissions
- [ ] Using correct access keys for the IAM user
- [ ] Region matches bucket region

## Still Not Working?

Check Vercel Function Logs for detailed error:
1. Go to Vercel Dashboard → Your Project
2. Click **Deployments** → Latest deployment
3. Click **Functions** tab
4. Click on `upload-s3`
5. Check **Logs** for specific AWS error messages

The logs will show the exact AWS error code which can help diagnose the issue.

