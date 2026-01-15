# Quick Start: Fix "S3 bucket name not configured" Error

## Immediate Steps to Fix the Error

### 1. Create `.env.local` file

In your `Quote1` folder, create a file named `.env.local` with this content:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_access_key_id_here
AWS_SECRET_ACCESS_KEY=your_secret_access_key_here
AWS_S3_BUCKET_NAME=your_bucket_name_here
```

### 2. Get Your AWS Credentials

You need 4 things from Amazon AWS:

#### A. AWS Region
- The region where you'll create your S3 bucket (e.g., `us-east-1`, `us-west-2`)
- Common regions: `us-east-1`, `us-west-2`, `eu-west-1`, `ap-south-1`

#### B. S3 Bucket Name
- Create a bucket in AWS S3 Console
- Must be globally unique (e.g., `my-pdf-uploads-2024`)
- See detailed steps in `S3_SETUP_GUIDE.md`

#### C. AWS Access Key ID
- Create an IAM user in AWS Console
- Generate access keys
- Format: `AKIA...` (starts with AKIA)
- See detailed steps in `S3_SETUP_GUIDE.md`

#### D. AWS Secret Access Key
- Generated when you create access keys
- **Save it immediately** - you can't see it again!
- See detailed steps in `S3_SETUP_GUIDE.md`

### 3. Fill in `.env.local`

Replace the placeholder values:

```env
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_S3_BUCKET_NAME=my-pdf-uploads-2024
```

### 4. Restart Your Server

**IMPORTANT:** After creating/updating `.env.local`, you MUST restart your Next.js server:

1. Stop the server (press `Ctrl+C` in terminal)
2. Start it again: `npm run dev`

Environment variables are only loaded when the server starts!

### 5. Test Again

Try uploading to S3 again - the error should be gone!

---

## Need Detailed Instructions?

See `S3_SETUP_GUIDE.md` for complete step-by-step instructions with screenshots guidance.

## Common Issues

**"Still getting the error after creating .env.local"**
- ✅ Did you restart the server? (Required!)
- ✅ Is the file named exactly `.env.local` (not `.env` or `.env.local.txt`)?
- ✅ Is the file in the `Quote1` folder (same folder as `package.json`)?
- ✅ Are all 4 variables filled in (no "your_xxx_here" placeholders)?

**"Don't have AWS account yet"**
- Sign up at https://aws.amazon.com/console/
- Free tier includes 5GB S3 storage for 12 months
- See `S3_SETUP_GUIDE.md` for account setup

