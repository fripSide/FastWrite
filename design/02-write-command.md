# Vibe Code - Feature Specification: Write Command

## Command: Write Section
**Command Alias:** `write` / `w`
**Syntax:** `w <section_id>`
**Example:** `w 0` (Targets files starting with `0-`, e.g., `0-intro.tex`)

### Logic Flow

1.  **Context & Validation**
    - Load `current_project` configuration to locate `sections_dir` and `proj_dir`.
    - **Locate Source File:** Find the LaTeX file in `sections_dir` that matches the pattern `{section_id}-*.tex` (e.g., `0-abstract.tex`).
      - *Error Handling:* If no file or multiple files match, abort with an error message.
    - **Locate Prompt File:** Find the corresponding Markdown prompt in `proj_dir/prompts/` matching `{section_id}-*.md`.
      - *Error Handling:* If the prompt file is missing, abort.

2.  **Rolling Backup Strategy**
    - **Target Directory:** `proj_dir/backups/`
    - **Naming Convention:** Use a precise timestamp to prevent overwriting.
      - Format: `{original_filename}.{YYYYMMDD_HHMMSS}.bak`
      - *Example:* `0-abstract.tex` -> `0-abstract.tex.20231027_143005.bak`
    - **Action:** Copy the *current* content of the source LaTeX file to this new backup path *before* any AI modification occurs.

3.  **AI Generation & Modification**
    - **Construct Context:** Combine:
      - System Prompt (`system.md`)
      - User Prompt (Content of `{section_id}-*.md`)
      - Current LaTeX Content (Content of `{section_id}-*.tex`)
    - **LLM Call:** Send context to the LLM to generate the revised LaTeX code.
    - **Overwrite:** Save the LLM's output directly to the original path in `sections_dir`, replacing the old content.

4.  **Post-Processing: Diff & Visualization**
    - **Generate Diff:** Compare the **Backup File** (Original) vs. **New File** (Modified).
    - **Output Format:** Generate a standalone HTML file highlighting additions (green) and deletions (red).
    - **Save Diff:** Save to `proj_dir/diffs/{original_filename}.{YYYYMMDD_HHMMSS}.diff.html`.
    - **Auto-Open:** Automatically trigger the default system browser to open the generated HTML diff file for immediate review.
      - *Implementation Hint:* Use `open` (macOS), `xdg-open` (Linux), or `start` (Windows).