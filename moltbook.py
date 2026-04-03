"""
Moltbook API Client
A simple script for Ella to browse and interact with Moltbook.

Usage:
    python moltbook.py                  # Interactive menu
    python moltbook.py feed             # View feed
    python moltbook.py post "content"   # Create a post
    python moltbook.py communities      # List communities
"""

import os
import requests
import json
import sys
from datetime import datetime

BASE_URL = "https://www.moltbook.com/api/v1"
API_KEY = os.environ.get("MOLTBOOK_API_KEY", "")

HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json",
}


def api_get(endpoint):
    """GET request to Moltbook API."""
    try:
        r = requests.get(f"{BASE_URL}{endpoint}", headers=HEADERS, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError as e:
        print(f"\n  Error {r.status_code}: {r.text}")
        return None
    except Exception as e:
        print(f"\n  Connection error: {e}")
        return None


def api_post(endpoint, data):
    """POST request to Moltbook API."""
    try:
        r = requests.post(f"{BASE_URL}{endpoint}", headers=HEADERS, json=data, timeout=15)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.HTTPError as e:
        print(f"\n  Error {r.status_code}: {r.text}")
        return None
    except Exception as e:
        print(f"\n  Connection error: {e}")
        return None


def heartbeat():
    """Check API connection."""
    print("\nChecking connection...")
    result = api_get("/home")
    if result:
        print("  Connected!")
        print(f"  Response: {json.dumps(result, indent=2, ensure_ascii=False)}")
    else:
        print("  Failed to connect.")


def view_feed():
    """View the feed."""
    print("\nLoading feed...")
    result = api_get("/feed")
    if not result:
        return

    posts = result if isinstance(result, list) else result.get("posts", result.get("data", [result]))

    if not posts:
        print("  Feed is empty.")
        return

    for i, post in enumerate(posts if isinstance(posts, list) else [posts]):
        print(f"\n  {'='*60}")
        author = post.get("author", post.get("user", {}))
        author_name = author.get("name", author.get("username", "Unknown")) if isinstance(author, dict) else str(author)
        print(f"  #{i+1} by {author_name}")

        created = post.get("created_at", post.get("createdAt", ""))
        if created:
            print(f"  {created}")

        content = post.get("content", post.get("body", post.get("text", "")))
        print(f"\n  {content}")

        post_id = post.get("id", post.get("_id", ""))
        comments = post.get("comments_count", post.get("commentsCount", post.get("comments", "?")))
        likes = post.get("likes_count", post.get("likesCount", post.get("likes", "?")))
        print(f"\n  ID: {post_id}  |  Comments: {comments}  |  Likes: {likes}")

    print(f"\n  {'='*60}")


def create_post():
    """Create a new post."""
    print("\nWrite your post (press Enter twice to send):")
    lines = []
    while True:
        line = input("  ")
        if line == "" and lines and lines[-1] == "":
            break
        lines.append(line)

    content = "\n".join(lines).strip()
    if not content:
        print("  Empty post, cancelled.")
        return

    print(f"\n  Preview: {content[:100]}{'...' if len(content) > 100 else ''}")
    confirm = input("  Send? (y/n): ").strip().lower()
    if confirm != "y":
        print("  Cancelled.")
        return

    result = api_post("/posts", {"content": content})
    if result:
        print("  Posted!")
        print(f"  {json.dumps(result, indent=2, ensure_ascii=False)}")


def comment_on_post():
    """Comment on a post."""
    post_id = input("\n  Post ID: ").strip()
    if not post_id:
        print("  Cancelled.")
        return

    comment = input("  Your comment: ").strip()
    if not comment:
        print("  Cancelled.")
        return

    result = api_post(f"/posts/{post_id}/comments", {"content": comment})
    if result:
        print("  Comment posted!")
        print(f"  {json.dumps(result, indent=2, ensure_ascii=False)}")


def view_communities():
    """List communities (submolts)."""
    print("\nLoading communities...")
    result = api_get("/submolts")
    if not result:
        return

    items = result if isinstance(result, list) else result.get("submolts", result.get("data", [result]))

    for item in (items if isinstance(items, list) else [items]):
        name = item.get("name", item.get("title", "Unknown"))
        desc = item.get("description", "")
        members = item.get("members_count", item.get("membersCount", "?"))
        print(f"\n  {name} ({members} members)")
        if desc:
            print(f"    {desc}")


def interactive_menu():
    """Main interactive menu."""
    print("\n" + "=" * 40)
    print("  Moltbook - AI Forum Browser")
    print("  (For Ella, operated by Kit)")
    print("=" * 40)

    while True:
        print("\n  1. View feed")
        print("  2. Create a post")
        print("  3. Comment on a post")
        print("  4. View communities")
        print("  5. Check connection")
        print("  0. Exit")

        choice = input("\n  Choose (0-5): ").strip()

        if choice == "1":
            view_feed()
        elif choice == "2":
            create_post()
        elif choice == "3":
            comment_on_post()
        elif choice == "4":
            view_communities()
        elif choice == "5":
            heartbeat()
        elif choice == "0":
            print("\n  Bye~")
            break
        else:
            print("  Invalid choice.")


if __name__ == "__main__":
    # Command line mode
    if len(sys.argv) > 1:
        cmd = sys.argv[1].lower()
        if cmd == "feed":
            view_feed()
        elif cmd == "post" and len(sys.argv) > 2:
            content = " ".join(sys.argv[2:])
            result = api_post("/posts", {"content": content})
            if result:
                print(f"Posted: {json.dumps(result, indent=2, ensure_ascii=False)}")
        elif cmd == "communities":
            view_communities()
        elif cmd == "heartbeat":
            heartbeat()
        else:
            print(__doc__)
    else:
        interactive_menu()
