* ComicVine API

The following worked:

```zsh
curl "https://comicvine.gamespot.com/api/characters/?api_key=1abcda4cfa2fcac1c404ac60ea807c2129dd6b3f&format=json&sort=name&field_list=name"
```

But the browser cannot access this because of CORS policy set up with the API server :(
But I set up my own proxy server as a Google Cloud Function, yay! :)

** More API Deets

As per [this](https://comicvine.gamespot.com/forums/api-developers-2334/need-help-with-filters-2154691/),
you can only filter on fields that return strings, numbers, or dates. Publisher is an object with a
name and id field and thus it means it's not filter-able :(

So:

  1. Fetch "https://comicvine.gamespot.com/api/volumes/?api_key=1abcda4cfa2fcac1c404ac60ea807c2129dd6b3f&format=json&filter=name:Showcase&field_list=name,publisher", with limit=100 and offset=0, get all pages and concatenate
  1. Filter it to only those volumes that have a publisher.name === 'DC Comics'
  1. Filter it again to only those volumes whos name is exactly 'Showcase'

Theoretically:

  1. Fetch "/search/?format=json&query=Showcase&resources=volume"
  1. Show volumes as search results with publisher, begin-end year, # of issues
  1. User picks the volume (id=1770) - auto-populate Series and Publisher
  1. Fetch "/issues/?format=json&filter=volume:1770&field_list=id,name,issue_number,publisher,volume" or add issue_number:17 to the filter if we can figure it out based on filename?"
  1. User picks issue - auto-populate


** Cookbook

*** Search for volumes called "Showcase"

This includes the id, name, publisher, and start year:

```bash
 curl "https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request/volumes?format=json&filter=name:Showcase&limit=20&field_list=id,name,publisher,start_year"
```

Or a general search:

```bash
curl "https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request/search?format=json&query=Showcase&field_list=id,name,publisher,start_year&resources=volume"
```

*** Search for Publishers with "DC" in the name:

```curl "https://us-central1-api-project-652854531961.cloudfunctions.net/function-proxy-request/publishers?format=json&filter=name:DC&limit=20&field_list=id,name"```

*** Search for 


** Approach

Goal is to get the following key fields populated:  Series, Publisher, Number, Year, Month, Volume (not sure how best to do Volume given ComicVine's storage of volume information...)

Certain editor inputs can have a search button next to it, populated only when the input has a string in it:

  * 
