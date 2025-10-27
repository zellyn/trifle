#!/usr/bin/env python3
"""
Convert Claude Code JSONL conversation logs to readable Markdown format.

Source: https://github.com/simonw/tools/blob/main/python/claude_to_markdown.py
Modified to support session import with redaction.
"""

import json
import sys
import re
import shutil
from datetime import datetime
from pathlib import Path


def redact_sensitive_data(text):
    """Redact sensitive information from text."""
    # Redact Google OAuth Client ID (numeric-alphanumeric.apps.googleusercontent.com)
    text = re.sub(
        r'\d+-[a-z0-9]+\.apps\.googleusercontent\.com',
        '[REDACTED-GOOGLE-CLIENT-ID]',
        text
    )

    # Redact Google OAuth Client Secret (GOCSPX- pattern)
    text = re.sub(
        r'GOCSPX-[A-Za-z0-9_-]{28}',
        '[REDACTED-GOOGLE-CLIENT-SECRET]',
        text
    )

    # Redact email addresses (generic pattern)
    # Match typical email but exclude noreply@anthropic.com and example/test domains
    # First, temporarily protect noreply@anthropic.com
    text = text.replace('noreply@anthropic.com', '<<<PROTECTED_NOREPLY>>>')

    # Redact all real emails (excluding common example domains)
    text = re.sub(
        r'\b[a-zA-Z0-9._%+-]+@(?!example\.com|domain\.com|test\.com)[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b',
        '[REDACTED-EMAIL]',
        text
    )

    # Restore the protected email
    text = text.replace('<<<PROTECTED_NOREPLY>>>', 'noreply@anthropic.com')

    return text


def format_timestamp(ts):
    """Format ISO timestamp to readable format."""
    try:
        dt = datetime.fromisoformat(ts.replace('Z', '+00:00'))
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except:
        return ts


def format_tool_use(tool):
    """Format tool use content."""
    name = tool.get('name', 'Unknown')
    tool_input = tool.get('input', {})

    md = f"**Tool:** `{name}`\n\n"

    if tool_input:
        md += "**Input:**\n```json\n"
        md += json.dumps(tool_input, indent=2)
        md += "\n```\n"

    return md


def format_tool_result(result):
    """Format tool result content."""
    content = result.get('content', '')

    if isinstance(content, list):
        # Handle structured content
        parts = []
        for item in content:
            if isinstance(item, dict):
                if item.get('type') == 'text':
                    parts.append(item.get('text', ''))
                else:
                    parts.append(str(item))
        content = '\n'.join(parts)

    md = "**Result:**\n```\n"
    md += str(content)
    md += "\n```\n"

    return md


def format_message_content(content):
    """Format message content (can be text, tool use, thinking, etc)."""
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                msg_type = item.get('type', 'text')

                if msg_type == 'text':
                    parts.append(item.get('text', ''))
                elif msg_type == 'thinking':
                    thinking = item.get('thinking', '')
                    if thinking:
                        parts.append(f"<details>\n<summary>💭 Thinking</summary>\n\n{thinking}\n</details>")
                elif msg_type == 'tool_use':
                    parts.append(format_tool_use(item))
                elif msg_type == 'tool_result':
                    parts.append(format_tool_result(item))
                else:
                    parts.append(str(item))
        return '\n\n'.join(parts)

    return str(content)


def process_jsonl_line(line):
    """Process a single JSONL line and convert to markdown."""
    try:
        data = json.loads(line)
    except json.JSONDecodeError:
        return None

    entry_type = data.get('type', 'unknown')

    # Skip file history snapshots
    if entry_type == 'file-history-snapshot':
        return None

    # Process user and assistant messages
    if entry_type in ['user', 'assistant']:
        message = data.get('message', {})
        role = message.get('role', entry_type)
        content = message.get('content', '')
        timestamp = data.get('timestamp', '')

        # Format header
        icon = '👤' if role == 'user' else '🤖'
        header = f"## {icon} {role.upper()}"

        if timestamp:
            header += f" — {format_timestamp(timestamp)}"

        # Format content
        formatted_content = format_message_content(content)

        # Add metadata if available
        metadata = []
        if entry_type == 'assistant':
            model = message.get('model', '')
            if model:
                metadata.append(f"**Model:** `{model}`")

            usage = message.get('usage', {})
            if usage:
                input_tokens = usage.get('input_tokens', 0)
                output_tokens = usage.get('output_tokens', 0)
                metadata.append(f"**Tokens:** {input_tokens} in / {output_tokens} out")

        cwd = data.get('cwd', '')
        if cwd:
            metadata.append(f"**Working Dir:** `{cwd}`")

        result = f"{header}\n\n"
        if metadata:
            result += '\n'.join(metadata) + '\n\n'
        result += f"{formatted_content}\n\n---\n"

        return result

    return None


def find_session_file(session_input):
    """
    Find session file from various input formats:
    - Full path: ~/.claude/projects/-Users-zellyn-gh-trifling/SESSION_ID.jsonl
    - Filename: SESSION_ID.jsonl
    - Session ID: SESSION_ID

    Returns Path object or None if not found.
    """
    # Try as direct path first
    if '/' in session_input:
        path = Path(session_input).expanduser()
        if path.exists():
            return path

    # Extract session ID (remove .jsonl if present)
    session_id = session_input.replace('.jsonl', '')

    # Search in common Claude project directories
    home = Path.home()
    search_dirs = [
        home / '.claude' / 'projects' / '-Users-zellyn-gh-trifling',
        home / '.claude' / 'projects' / '-Users-zellyn-gh-trifle',
        home / '.claude' / 'projects' / '-Users-zellyn-gh-trunkit',
    ]

    for search_dir in search_dirs:
        if search_dir.exists():
            candidate = search_dir / f"{session_id}.jsonl"
            if candidate.exists():
                return candidate

    return None


def copy_and_redact_session(source_path, dest_dir):
    """Copy session JSONL to destination with redaction."""
    dest_dir = Path(dest_dir)
    dest_dir.mkdir(parents=True, exist_ok=True)

    dest_path = dest_dir / source_path.name

    # Read, redact, and write
    with open(source_path, 'r', encoding='utf-8') as infile, \
         open(dest_path, 'w', encoding='utf-8') as outfile:
        content = infile.read()
        redacted_content = redact_sensitive_data(content)
        outfile.write(redacted_content)

    print(f"✓ Copied and redacted: {dest_path}")
    return dest_path


def convert_jsonl_to_markdown(input_file, output_file=None):
    """Convert JSONL file to Markdown."""
    input_path = Path(input_file)

    if not input_path.exists():
        print(f"Error: File '{input_file}' not found.", file=sys.stderr)
        return 1

    # Determine output file
    if output_file is None:
        output_file = input_path.with_suffix('.md')

    output_path = Path(output_file)

    # Process file
    entries_processed = 0
    with open(input_path, 'r', encoding='utf-8') as infile, \
         open(output_path, 'w', encoding='utf-8') as outfile:

        # Write header
        outfile.write(f"# Claude Code Conversation Log\n\n")
        outfile.write(f"**Source:** `{input_path.name}` \n")
        outfile.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        outfile.write("---\n\n")

        # Process each line
        for line_num, line in enumerate(infile, 1):
            line = line.strip()
            if not line:
                continue

            try:
                markdown = process_jsonl_line(line)
                if markdown:
                    outfile.write(markdown)
                    entries_processed += 1
            except Exception as e:
                print(f"Warning: Error processing line {line_num}: {e}", file=sys.stderr)
                continue

        print(f"✓ Converted {entries_processed} entries")
        print(f"✓ Output written to: {output_path}")
        return 0


def import_session(session_input):
    """
    Import a session: find it, redact, and convert directly to markdown.
    Does not save redacted JSONL files.
    Assumes script is in docs/sessions/ directory.
    """
    # Find the session file
    source_path = find_session_file(session_input)
    if not source_path:
        print(f"Error: Could not find session file for '{session_input}'", file=sys.stderr)
        print("Searched in ~/.claude/projects/", file=sys.stderr)
        return 1

    print(f"Found: {source_path}")

    # Determine output directory (script should be in docs/sessions/)
    script_dir = Path(__file__).parent
    md_dir = script_dir / 'md'
    md_dir.mkdir(parents=True, exist_ok=True)

    # Output markdown path
    session_id = source_path.stem
    md_path = md_dir / f"{session_id}.md"

    # Read source, redact, and convert to markdown
    print(f"Converting and redacting: {source_path.name}")

    entries_processed = 0
    with open(source_path, 'r', encoding='utf-8') as infile, \
         open(md_path, 'w', encoding='utf-8') as outfile:

        # Write header
        outfile.write(f"# Claude Code Conversation Log\n\n")
        outfile.write(f"**Source:** `{source_path.name}` \n")
        outfile.write(f"**Generated:** {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n")
        outfile.write("---\n\n")

        # Read entire file and redact
        content = infile.read()
        redacted_content = redact_sensitive_data(content)

        # Process each line
        for line_num, line in enumerate(redacted_content.split('\n'), 1):
            line = line.strip()
            if not line:
                continue

            try:
                markdown = process_jsonl_line(line)
                if markdown:
                    outfile.write(markdown)
                    entries_processed += 1
            except Exception as e:
                print(f"Warning: Error processing line {line_num}: {e}", file=sys.stderr)
                continue

    print(f"✓ Converted {entries_processed} entries")
    print(f"✓ Output written to: {md_path}")
    print(f"\n✓ Session imported successfully!")
    print(f"  MD: {md_path}")

    return 0


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print("Usage:")
        print("  Import mode:  python claude_to_markdown.py --import <session_id|filename|path>")
        print("  Convert mode: python claude_to_markdown.py <input.jsonl> [output.md]")
        print("\nImport mode finds session in ~/.claude/projects/, redacts sensitive data,")
        print("and generates markdown directly in docs/sessions/md/ (does not save JSONL)")
        print("\nConvert mode simply converts an existing JSONL file to Markdown.")
        return 1

    # Check for import mode
    if sys.argv[1] == '--import':
        if len(sys.argv) < 3:
            print("Error: --import requires a session identifier", file=sys.stderr)
            return 1
        return import_session(sys.argv[2])

    # Traditional convert mode
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None

    return convert_jsonl_to_markdown(input_file, output_file)


if __name__ == '__main__':
    sys.exit(main())
