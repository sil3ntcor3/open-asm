# Reports

The Reports page lets console users generate PDF reports for the selected workspace, download saved PDFs, and delete reports that are no longer needed.

## Report Types

Open-ASM currently provides two report templates:

- **Summary Report**: An attack surface overview with asset, target, vulnerability, discovery, and trend information.
- **Vulnerability Report**: A vulnerability assessment with severity distribution, finding details, and remediation context.

## Generate a Report

1. Open **Reports** from the Security menu.
2. Select the **Templates** tab.
3. Choose **Summary Report** or **Vulnerability Report**.
4. In the generation dialog, optionally choose a date range.
5. For vulnerability reports, optionally choose a minimum severity.
6. Select **Generate**.

Generated reports are saved to the current workspace and appear in the report list after generation succeeds.

Leaving the date range empty includes all available workspace data. For vulnerability reports, the minimum severity filter includes the selected severity and higher severities.

## Find and Manage Reports

The report list has three saved-report views:

- **All**: Shows every saved report in the workspace.
- **Summary**: Shows only saved summary reports.
- **Vulnerability**: Shows only saved vulnerability reports.

Use the table search to filter by file name. Use column sorting and pagination to move through larger report sets.

Each report row includes:

- **Download**: Opens the saved PDF in a new browser tab.
- **Delete**: Permanently removes the report from the workspace and deletes the stored PDF.

Download links are generated when reports are loaded and are time limited. If a download link expires, refresh the Reports page and download the report again.

## Notes

- Reports are scoped to the currently selected workspace.
- Report files are generated as PDFs.
- Deleting a report does not delete underlying assets, targets, vulnerabilities, jobs, or scans. It only removes the saved PDF report record and file.
