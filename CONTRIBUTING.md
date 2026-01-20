# Contributing to PaperPlain

First off, thank you for taking the time to contribute 🙌  
PaperPlain is an open-source project that makes academic research more accessible by turning dense academic papers into plain English. Contributions of all kinds are welcome — code, documentation, design, ideas, and feedback.

This document explains how to get started and how to contribute effectively.

---

## 🧭 Ways to Contribute

You can help in several ways:

- **Bug reports** – Report crashes, errors, or unexpected behavior.
- **Feature requests** – Suggest new ideas or enhancements.
- **Code contributions** – Fix bugs, add features, or improve performance.
- **Documentation** – Improve README files, setup instructions, or examples.
- **UX/UI feedback** – Propose improvements to flows, layout, or clarity.

If you’re unsure whether your idea fits, feel free to open an issue to discuss it.

---

## 📜 Code of Conduct

By participating in this project, you agree to help maintain a respectful, inclusive, and harassment-free environment for everyone.

---

## ⚙️ Development Setup

### 1. Fork and clone the repository

```bash
git clone https://github.com/<your-username>/PaperPlain.git
cd PaperPlain
```

### 2. Install dependencies

```bash
npm install
```

### 3. Environment variables

Create a `.env` file in the project root and add the required environment variables as described in `README.md` (API keys, database URLs, authentication secrets, etc.).

> ⚠️ Never commit your `.env` file or secrets.

### 4. Database and authentication

Follow the instructions in `README.md` to:
- Configure authentication
- Set up the database
- Run any required migrations

### 5. Run the project locally

```bash
npm run dev
```

The app should be available at:

```
http://localhost:3000
```

---

## 🧱 Project Structure (High-Level)

```text
PaperPlain/
├── api/                # Backend API routes
├── public/             # Static assets
├── auth.js             # Authentication setup
├── db.js               # Database configuration
├── server.js           # Server entry point
├── docker-compose.yml  # Optional Docker setup
├── README.md           # Project documentation
├── LICENSE             # MIT License
```

Please keep new files consistent with the existing structure and coding style.

---

## 🧪 Testing & Quality

If tests or linters are available, run them before submitting a pull request:

```bash
npm test
npm run lint
```

Guidelines:
- Ensure existing functionality continues to work
- Add tests for new features where appropriate
- Keep code readable and well-commented

---

## 🌿 Branching & Commit Guidelines

- Create a new branch from `main` for your work:
  
  ```bash
  git checkout -b feat/short-description
  ```

- Write clear and descriptive commit messages:
  - `feat: add paper summarization limits`
  - `fix: handle invalid PDF uploads`
  - `docs: update setup instructions`

- Keep pull requests focused and reasonably sized.

---

## 🔁 Pull Request Process

1. Ensure your branch is up to date with `main`.
2. Push your changes to your fork.
3. Open a pull request against the `main` branch.
4. Include in your PR description:
   - What you changed
   - Why you changed it
   - How to test it
   - Screenshots (for UI changes)

Be open to feedback and iteration — collaboration is encouraged.

---

## 🐛 Bug Reports

When opening a bug report, please include:
- Steps to reproduce
- Expected behavior
- Actual behavior
- Screenshots or logs (if applicable)
- Your environment (OS, browser, Node version)

---

## 💡 Feature Requests

Feature requests should describe:
- The problem being solved
- The proposed solution
- Possible alternatives
- Expected impact

This helps maintainers evaluate and prioritize ideas.

---

## 🔐 Security

- Do not commit secrets, API keys, or credentials.
- Do not share sensitive information in issues or pull requests.
- If you discover a security issue, please report it privately to the maintainer.

---

## 🙏 Thank You

Thank you for helping make PaperPlain better and for contributing to more accessible research for everyone.
