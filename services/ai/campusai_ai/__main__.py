"""python -m campusai_ai.worker entry point."""
from .worker import *  # noqa: F401,F403
from .worker import run_forever
import asyncio
import logging

if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    from .embeddings import get_embedder

    get_embedder().warm_up()
    asyncio.run(run_forever())
