"""
4 U By U — Real-Time Web Search Module (DuckDuckGo + BeautifulSoup)
Zero-cost, zero-API-key fallback for out-of-handbook questions.
"""

import urllib.parse
from typing import List, Dict, Any
import requests
from bs4 import BeautifulSoup

def search_web_duckduckgo(query: str, max_results: int = 5) -> List[Dict[str, str]]:
    """
    Performs real-time web search via DuckDuckGo HTML endpoint and parses with BeautifulSoup.
    100% free, no API keys required.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        )
    }
    url = "https://html.duckduckgo.com/html/"
    
    try:
        resp = requests.post(
            url,
            data={"q": query},
            headers=headers,
            timeout=7
        )
        if resp.status_code != 200:
            return []
        
        soup = BeautifulSoup(resp.text, "html.parser")
        results = []
        for res in soup.select(".result"):
            title_tag = res.select_one(".result__title a")
            snippet_tag = res.select_one(".result__snippet")
            if title_tag and snippet_tag:
                title = title_tag.get_text(strip=True)
                link = title_tag.get("href", "")
                snippet = snippet_tag.get_text(strip=True)
                
                # Filter out ads or empty snippets
                if title and snippet:
                    results.append({
                        "title": title,
                        "link": link,
                        "snippet": snippet
                    })
                    if len(results) >= max_results:
                        break
        return results
    except Exception as e:
        print(f"[WebSearch] Error fetching web results: {e}")
        return []

def format_web_context(results: List[Dict[str, str]]) -> str:
    """Formats web search results into structured LLM context string."""
    if not results:
        return "No external web results available."
    
    formatted = ["=== REAL-TIME EXTERNAL WEB SEARCH RESULTS ==="]
    for idx, r in enumerate(results, 1):
        formatted.append(f"[{idx}] {r['title']}\nSource URL: {r['link']}\nSummary: {r['snippet']}\n")
    return "\n".join(formatted)
