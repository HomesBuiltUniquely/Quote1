# Vercel Production Setup Guide

## Setting Up Environment Variables in Vercel

Your S3 upload is failing in production because environment variables are not configured in Vercel. Follow these steps:

### Step 1: Go to Vercel Dashboard

1. Go to [Vercel Dashboard](https://vercel.com/dashboard)
2. Select your project

### Step 2: Add Environment Variables

1. Click on **Settings** tab
2. Click on **Environment Variables** in the left sidebar
3. Add the following 4 environment variables:

#### Required Environment Variables:

1. **AWS_REGION**
   - Value: Your AWS region (e.g., `ap-south-2`, `us-east-1`)
   - Example: `ap-south-2`

2. **AWS_ACCESS_KEY_ID**
   - Value: Your AWS Access Key ID (starts with `AKIA...`)
   - Example: `AKIAXXXXXXXXXXXXXXXX`

3. **AWS_SECRET_ACCESS_KEY**
   - Value: Your AWS Secret Access Key
   - ⚠️ **Important:** Mark this as "Sensitive" in Vercel
   - Example: `your_secret_access_key_here`

4. **AWS_S3_BUCKET_NAME**
   - Value: Your S3 bucket name
   - Example: `your-bucket-name-here`

### Step 3: Set Environment Scope

For each variable, select the environments where it should be available:
- ✅ **Production** (required)
- ✅ **Preview** (optional, for testing)
- ✅ **Development** (optional)

### Step 4: Redeploy

After adding environment variables:

1. Go to **Deployments** tab
2. Click the **"..."** menu on the latest deployment
3. Click **"Redeploy"**
   - OR
4. Push a new commit to trigger automatic redeployment

**Important:** Environment variables are only loaded on deployment. You MUST redeploy after adding them!

### Step 5: Verify

After redeployment:

1. Test the S3 upload in production
2. Check Vercel Function Logs if it still fails:
   - Go to **Deployments** → Click on deployment → **Functions** tab
   - Click on `upload-s3` function
   - Check **Logs** for error messages

## Common Production Issues

### Issue: "S3 bucket name not configured"
**Solution:** Add `AWS_S3_BUCKET_NAME` in Vercel Environment Variables

### Issue: "AWS credentials not configured"
**Solution:** Add `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` in Vercel

### Issue: "Access Denied" or "403 Forbidden"
**Solution:** 
- Check IAM user has `PutObject` and `GetObject` permissions
- Verify bucket name and region are correct
- Ensure bucket exists in the specified region

### Issue: "NoSuchBucket" or "404"
**Solution:**
- Verify bucket name is correct (case-sensitive)
- Check `AWS_REGION` matches the bucket's region
- Ensure bucket exists in your AWS account

### Issue: Timeout errors
**Solution:**
- Check `vercel.json` has proper timeout settings (already configured)
- Large PDFs might need more time - increase `maxDuration` if needed

## Quick Checklist

- [ ] All 4 environment variables added in Vercel
- [ ] Variables set for Production environment
- [ ] Redeployed after adding variables
- [ ] IAM user has PutObject and GetObject permissions
- [ ] Bucket name and region are correct

## Security Best Practices

1. ✅ Never commit `.env.local` to git (already in `.gitignore`)
2. ✅ Use Vercel's Environment Variables for production secrets
3. ✅ Mark sensitive values (like Secret Access Key) as "Sensitive" in Vercel
4. ✅ Use IAM policies with least privilege
5. ✅ Rotate access keys regularly

## Testing After Setup

1. Upload an Excel file in production
2. Generate preview
3. Click "Upload to S3"
4. Check that the S3 URL appears
5. Verify file exists in your S3 bucket

If you still encounter issues, check the Vercel Function Logs for detailed error messages.

