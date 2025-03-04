## Prerequisites

* **[Node.js](https://nodejs.org/en/download):** Ensure you have Node.js and npm (Node Package Manager) installed on your system.
* **[Git](https://git-scm.com/downloads/win) (Optional):** Git is required if you want to clone the repository. Alternatively, you can download the source code as a ZIP file.

## Using Git

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/cgize/ipm-tool.git
    cd ipm-tool
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```
    This command will install all the necessary dependencies listed in the `package.json` file.
3.  **Build the app:**
    ```bash
    npx electron-builder --win portable
    ```
    This command will build the Electron app for Windows in portable format.

## Downloading the Source Code (Without Git)

1.  **Download the ZIP file:**
    * Go to your GitHub repository.
    * Click the "Code" button.
    * Select "Download ZIP".
    * Extract the ZIP file to a folder on your computer.
2.  **Open the folder:**
    * Open your terminal or command prompt.
    * Navigate to the extracted folder using the `cd` command.
3.  **Install dependencies:**
    ```bash
    npm install
    ```
    This command will install all the necessary dependencies listed in the `package.json` file.
4.  **Build the app:**
    ```bash
    npx electron-builder --win portable
    ```
    This command will build the Electron app for Windows in portable format.

## Notes

* The built app will be located in the `dist` folder.
