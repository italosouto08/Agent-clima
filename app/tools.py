import time
from langchain_core.tools import tool

@tool
def get_weather(city: str) -> dict:
    """Get the current weather for a city """
    time.sleep(2)
    return {
        "city": city,
        "temp_c": 22,
        "condition": "parcialmente nublado",
    }