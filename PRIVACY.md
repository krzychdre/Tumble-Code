# Tumble Code Privacy Policy

**Last Updated: 2026-10-02**

Tumble Code respects your privacy and is committed to transparency about how we handle your data. Below is a simple breakdown of where key pieces of data go—and, importantly, where they don't.

### **Where Your Data Goes (And Where It Doesn't)**

- **Code & Files**: Tumble Code accesses files on your local machine when needed for AI-assisted features. When you send commands to Tumble Code, relevant files may be transmitted to your chosen AI model provider (e.g., OpenAI, Anthropic, OpenRouter) to generate responses. If you configure the Tumble Code Cloud provider (proxy mode) pointing at a self-hosted backend (see [self-hosted-cloudapi/](./self-hosted-cloudapi/)), your code transits that backend only to forward it to the upstream provider; the backend you operate determines what is logged or retained. Otherwise, your code is sent directly to the provider. AI providers may store data per their privacy policies.
- **Commands**: Any commands executed through Tumble Code happen on your local environment. When you use AI-powered features, the relevant code and context from your commands may be transmitted to your chosen AI model provider (e.g., OpenAI, Anthropic, OpenRouter) to generate responses. The Tumble Code project does not have access to or store this data, but AI providers may process it per their privacy policies.
- **Prompts & AI Requests**: When you use AI-powered features, your prompts and relevant project context are sent to your chosen AI model provider (e.g., OpenAI, Anthropic, OpenRouter) to generate responses. The Tumble Code project does not store or process this data. These AI providers have their own privacy policies and may store data per their terms of service. If you configure a Tumble Code Cloud provider (proxy mode), prompts transit the backend you have configured.
- **API Keys & Credentials**: If you enter an API key (e.g., to connect an AI model), it is stored locally on your device by VS Code's secret storage and never sent to the Tumble Code project or any third party, except the provider you have chosen.
- **Telemetry (Usage Data)**: Tumble Code sends usage events only to the Tumble Code Cloud backend you sign in to (see [self-hosted-cloudapi/](./self-hosted-cloudapi/)), and only while you are signed in. Nothing is sent when you are not signed in, and no third-party analytics service is used. The events cover feature usage (tasks, and which tool, mode or button was used), errors (their message, where they happened and a shortened stack trace, which can name files and folders on your machine) and model usage (model, tokens, cost), which the backend shows on its metrics and diagnostics pages. They carry the extension and editor version, platform, language, mode, task and model identifiers, and the git remote URL, repository name and default branch of the workspace. They do **not** contain your code or AI prompts, except the task messages uploaded when you turn on task sync or share a task. To stop them, sign out of the cloud, set `TUMBLE_CODE_DISABLE_TELEMETRY=1` for the extension, or set `TELEMETRY_ENABLED=false` on the backend.
- **Marketplace Requests**: When you browse or search the Marketplace for Model Configuration Profiles (MCPs) or Custom Modes, Tumble Code makes API calls to the configured backend (default: the self-hosted backend in this repo). These requests send only the query parameters (e.g., extension version, search term) necessary to fulfill the request and do not include your code, prompts, or personally identifiable information.

### **How We Use Your Data (If Collected)**

- The Tumble Code project itself does not operate any cloud service that collects user data.
- Any telemetry or cloud features point at a backend you operate (via `self-hosted-cloudapi/` or your own implementation).
- We do **not** sell or share your data. We do **not** train any models on your data.

### **Your Choices & Control**

- You can run models locally to prevent data being sent to third-parties.
- Telemetry goes only to the cloud backend you sign in to; without signing in nothing is sent.
- You can uninstall Tumble Code to stop all data collection.

### **Security & Updates**

We take reasonable measures to secure your data, but no system is 100% secure. If this privacy policy changes, the change will be visible in the repository history.

### **Contact Us**

<!-- For any privacy-related questions, please open a [GitHub issue](https://github.com/krzychdre/tumble-code/issues) or a private [security advisory](https://github.com/krzychdre/tumble-code/security/advisories/new). -->

For any privacy-related questions, please reach out through whichever contact channel Tumble Code publishes once it has one set up.

---

By using Tumble Code, you agree to this Privacy Policy.
