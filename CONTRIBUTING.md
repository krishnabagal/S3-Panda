# Contributing to S3 Panda

Thank you for your interest in contributing! 🐼

## How to Contribute

1. **Fork** the repository on GitHub
2. **Clone** your fork: `git clone https://github.com/krishnabagal/s3panda.git`
3. **Install** dependencies: `cd s3panda && npm install`
4. **Create a branch**: `git checkout -b feature/your-feature-name`
5. **Make your changes** and test locally with `node server.js`
6. **Commit**: `git commit -m "feat: describe your change"`
7. **Push**: `git push origin feature/your-feature-name`
8. **Open a Pull Request** on GitHub

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|---|---|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation changes only |
| `style:` | Formatting, no logic changes |
| `refactor:` | Code restructure without feature change |
| `perf:` | Performance improvement |

**Examples:**
```
feat: add folder creation support
fix: correct pre-signed URL expiry calculation
docs: add curl examples to API Reference
```

## Code Style

- 2-space indentation throughout
- Keep functions small and single-purpose
- Add comments for non-obvious AWS SDK interactions
- Test with real AWS credentials before submitting
- All AWS calls must remain non-destructive unless explicitly a delete/upload feature
- Never log `ak` or `sk` values — not even partially

## Testing Locally Without AWS Credentials

You can test the UI with mock data by temporarily modifying the API routes in `server.js` to return hardcoded JSON responses. The frontend will render normally from any JSON matching the documented response shape.

## Reporting Bugs

Open a GitHub issue and include:

- Node.js version (`node --version`)
- AWS region you were using
- Full error message from the browser console or terminal
- Steps to reproduce

## Feature Requests

Open a GitHub issue with the label `enhancement`. Please describe:

- What problem it solves
- How you'd expect it to work
- Any AWS S3 APIs it would require

## Adding a New API Route

1. Add the route to `server.js` following the existing pattern:

```js
app.get("/api/your-route", async (req, res) => {
  const c = guard(req, res); if (!c) return;
  const { bucket, region = "ap-south-1" } = req.query;
  try {
    const s3 = makeS3(c.ak, c.sk, region);
    // your AWS SDK call here
    res.json({ result: "..." });
  } catch (err) {
    console.error("YourRoute:", err.message);
    res.status(500).json({ error: friendlyError(err) });
  }
});
```

2. Always use `guard(req, res)` to validate credentials first
3. Always use `makeS3(ak, sk, region)` — never use a global S3 client
4. Add the new S3 action to `s3panda-iam-policy.json`
5. Document the route in `README.md` under API Reference

## Adding a New UI Feature

1. All frontend code lives in `public/index.html` — keep it self-contained
2. Add new API calls via the `apiCall()` helper which automatically attaches credentials
3. Follow the existing toast/error pattern for user feedback
4. Test at multiple viewport widths

## License

By contributing, you agree your code will be released under the [MIT License](./LICENSE).
