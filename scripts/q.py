import asyncio, sys, asyncpg
async def main():
    c = await asyncpg.connect("postgresql://campusai:campusai@localhost:5432/campusai")
    for r in await c.fetch(sys.argv[1]):
        print(dict(r))
asyncio.run(main())
