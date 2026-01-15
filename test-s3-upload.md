# Test S3 Upload - Diagnostic Steps

## Step 1: Check Browser Console

1. Open your production app
2. Press **F12** to open Developer Tools
3. Go to **Console** tab
4. Try uploading to S3
5. Look for error messages that show:
   - Status code (403, 404, 500, etc.)
   - Error message
   - Details

## Step 2: Check Network Tab

1. In Developer Tools, go to **Network** tab
2. Try uploading to S3
3. Find the request to `/api/upload-s3`
4. Click on it
5. Check:
   - **Status Code** (should show 403, 404, 500, etc.)
   - **Response** tab - shows the actual error message from API

## Step 3: Check Vercel Function Logs

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project
3. Go to **Deployments** tab
4. Click on the latest deployment
5. Click **Functions** tab
6. Click on `upload-s3`
7. Check **Logs** tab for:
   - "S3 upload error:" messages
   - AWS error codes
   - Detailed error information

## Common Error Messages and Solutions

### "Access Denied" or 403
**Solution:** IAM user needs permissions - see `FIX_403_ERROR.md`

### "Bucket not found" or 404
**Solution:** 
- Check bucket name matches exactly
- Verify region is correct
- Ensure bucket exists in AWS

### "Invalid credentials" or 401
**Solution:**
- Verify Access Key ID and Secret Access Key in Vercel
- Check for typos
- Ensure keys are for the correct IAM user

### "Network timeout"
**Solution:**
- Check Vercel function timeout settings
- Large PDFs might need more time

## Quick Test: Check Environment Variables

Make sure these are set in Vercel:
- ✅ `AWS_REGION`
- ✅ `AWS_ACCESS_KEY_ID`
- ✅ `AWS_SECRET_ACCESS_KEY`
- ✅ `AWS_S3_BUCKET_NAME`

## Still Not Working?

Share the exact error message from:
1. Browser Console (the detailed error)
2. Network tab response
3. Vercel Function Logs

This will help identify the exact issue.

