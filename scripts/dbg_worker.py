import asyncio, logging
logging.basicConfig(level=logging.INFO)
from campusai_ai import worker
async def main():
    print("claimed:", await worker.process_one("dbg"))
asyncio.run(main())
