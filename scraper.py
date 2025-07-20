import requests
import time
import json
import re 
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, WebDriverException

# --- Configuration ---
WEEKLY_AD_PAGE_URL = "https://www.rossgranvillemarket.com/weekly-ad"
APP_KEY = "ross_iga_market"
TOKEN = "93a6d196228decaa2d29e249debfcc0c"
STORE_ID = "2731"

HEADERS = {
    'User-Agent': 'Denison-Price-Tracker/1.0 (Student Project; contact: your-email@denison.edu)'
}

# --- Part 1: Weekly Ad Scraper ---

def get_current_circular_id():
    """Uses Selenium to find the current weekly ad ID from the page's HTML."""
    print("--- Step 0: Finding the current weekly ad ID ---")
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--no-sandbox")
    chrome_options.add_argument("--disable-dev-shm-usage")
    
    try:
        service = Service() 
        driver = webdriver.Chrome(service=service, options=chrome_options)
    except WebDriverException:
        print("Error: chromedriver not found. Make sure it's installed (brew install chromedriver).")
        return None

    try:
        driver.get(WEEKLY_AD_PAGE_URL)
        time.sleep(10)
        page_source = driver.page_source
        match = re.search(r'href="https://circulars\.freshop\.ncrcloud\.com/(\d+)-', page_source)
        
        if match:
            current_ad_id = match.group(1)
            print(f"Success! Found current ad ID: {current_ad_id}")
            return current_ad_id
        else:
            print("Could not find the circular ID in the PDF link.")
            return None
    except Exception as e:
        print(f"An error occurred in get_current_circular_id: {e}")
        return None
    finally:
        driver.quit()

def get_ad_page_ids(circular_id):
    """Gets all the individual page IDs for the current ad."""
    page_ids_url = f"https://api.freshop.ncrcloud.com/1/circular_pages?app_key={APP_KEY}&circular_id={circular_id}&token={TOKEN}"
    print(f"\n--- Step 1: Getting all ad page IDs ---")
    try:
        response = requests.get(page_ids_url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        page_ids = [page['id'] for page in data.get('items', [])]
        print(f"Found {len(page_ids)} pages in this week's ad.")
        return page_ids
    except requests.exceptions.RequestException as e:
        print(f"Error fetching page IDs: {e}")
        return []

def get_sale_products_from_page(page_id):
    """Gets all product details from a single page of the ad."""
    products_url = f"https://api.freshop.ncrcloud.com/1/products?app_key={APP_KEY}&circular_page_id={page_id}&limit=-1&token={TOKEN}&store_id={STORE_ID}&intent=circular"
    try:
        response = requests.get(products_url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        return data.get('items', [])
    except requests.exceptions.RequestException as e:
        print(f"  > Error fetching products for ad page {page_id}: {e}")
        return []

def scrape_weekly_ad():
    """Orchestrates the entire weekly ad scraping process."""
    print("--- Starting Weekly Ad Scrape ---")
    circular_id = get_current_circular_id()
    if not circular_id:
        return []
    
    page_ids = get_ad_page_ids(circular_id)
    if not page_ids:
        return []

    all_sale_items = []
    for i, p_id in enumerate(page_ids):
        print(f"({i+1}/{len(page_ids)}) Fetching sale items for Page ID: {p_id}...")
        products_on_page = get_sale_products_from_page(p_id)
        if products_on_page:
            print(f"  > Success: Found {len(products_on_page)} items on this ad page.")
            all_sale_items.extend(products_on_page)
        time.sleep(2)
    return all_sale_items

# --- Part 2: Full Catalog Scraper ---

def get_all_department_ids():
    """Gets the IDs for every department in the store."""
    print("\n--- Starting Full Catalog Scrape ---")
    print("--- Step 3: Getting all department IDs ---")
    # This is the URL that gives us the store's department structure
    departments_url = f"https://api.freshop.ncrcloud.com/1/products?app_key={APP_KEY}&department_id_cascade=true&include_departments=true&limit=0&store_id={STORE_ID}&token={TOKEN}"
    try:
        response = requests.get(departments_url, headers=HEADERS)
        response.raise_for_status()
        data = response.json()
        department_ids = [dept['id'] for dept in data.get('departments', [])]
        print(f"Found {len(department_ids)} departments to scrape.")
        return department_ids
    except requests.exceptions.RequestException as e:
        print(f"Error fetching department list: {e}")
        return []

def get_all_products_in_department(dept_id):
    """Scrapes all products from a single department, handling pagination."""
    all_products = []
    skip = 0
    limit = 100 # Fetch 100 items at a time
    
    while True:
        # This is the main product grid API endpoint
        products_url = f"https://api.freshop.ncrcloud.com/1/products?app_key={APP_KEY}&department_id={dept_id}&limit={limit}&skip={skip}&sort=popularity&store_id={STORE_ID}&token={TOKEN}"
        
        try:
            response = requests.get(products_url, headers=HEADERS)
            response.raise_for_status()
            data = response.json()
            
            items = data.get('items', [])
            if not items:
                break # Exit loop if no more items are returned
            
            all_products.extend(items)
            skip += limit
            
            # Polite delay
            time.sleep(1)

        except requests.exceptions.RequestException as e:
            print(f"  > Error fetching products for department {dept_id}: {e}")
            break
            
    return all_products

def scrape_full_catalog():
    """Orchestrates the entire full catalog scraping process."""
    department_ids = get_all_department_ids()
    if not department_ids:
        return []
        
    all_products = []
    for i, dept_id in enumerate(department_ids):
        print(f"\n({i+1}/{len(department_ids)}) Scraping Department ID: {dept_id}...")
        products_in_dept = get_all_products_in_department(dept_id)
        if products_in_dept:
            print(f"  > Success: Found {len(products_in_dept)} items in this department.")
            all_products.extend(products_in_dept)
        time.sleep(2)
    return all_products

# --- Main Execution ---

def main():
    """Runs both scrapers and combines the data."""
    sale_items = scrape_weekly_ad()
    regular_items = scrape_full_catalog()
    
    print("\n--- Combining and Finalizing Data ---")
    
    # Use a dictionary to store items by their ID to handle duplicates.
    # The sale items will overwrite regular items if they exist in both lists.
    master_product_list = {}
    
    # Process regular items first
    for item in regular_items:
        item_id = item.get('id')
        if item_id:
            master_product_list[item_id] = {
                "name": item.get('name'),
                "regular_price": item.get('price'),
                "sale_price": item.get('sale_price'), # Might be null, that's ok
                "size": item.get('size'),
                "department": item.get('department_id')
            }
            
    # Process sale items second, overwriting any duplicates
    for item in sale_items:
        item_id = item.get('id')
        if item_id:
            master_product_list[item_id] = {
                "name": item.get('name'),
                "regular_price": item.get('price'),
                "sale_price": item.get('sale_price'),
                "size": item.get('size'),
                "department": item.get('department_id')
            }
            
    # Convert the dictionary back to a list
    final_list = list(master_product_list.values())
    
    print(f"\n--- Scraping Complete! ---")
    print(f"Total unique items found: {len(final_list)}")
    
    with open('full_store_prices.json', 'w') as f:
        json.dump(final_list, f, indent=4)
    print("\nFull store data saved to full_store_prices.json")

if __name__ == "__main__":
    main()
