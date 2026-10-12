import json
import logging
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from .models import Request as ValidateRequest, SolveRequest
from .validation import validate
from .solver import solve

router = APIRouter(prefix="/api/geometry")


async def execute(request, model, solving=False):
    request_id = None
    try:
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > 2 * 1024 * 1024:
                return JSONResponse(
                    status_code=413, content={"detail": "Документ больше 2 МиБ."}
                )
        data = json.loads(body)
        request_id = data.get("requestId") if isinstance(data, dict) else None
        parsed = model.model_validate(data)
        result = {"requestId": parsed.requestId, "draftRevision": parsed.draftRevision}
        if solving:
            geometry, report, changed = solve(parsed.geometry, parsed.operation)
            result.update(
                geometry=geometry.model_dump(),
                validation=report,
                changedWallIds=changed,
            )
        else:
            result["validation"] = validate(parsed.geometry)
        return result
    except (ValidationError, ValueError, KeyError) as exc:
        return JSONResponse(
            status_code=422,
            content={
                "detail": "Некорректный документ геометрии.",
                "code": "INVALID_GEOMETRY_DOCUMENT",
                "issues": [],
            },
        )
    except Exception:
        logging.getLogger(__name__).error(
            "Geometry operation failed requestId=%s", str(request_id)[:100]
        )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Не удалось проверить геометрию. Повторите запрос.",
                "requestId": request_id,
            },
        )


@router.post("/validate")
async def validate_route(request: Request):
    return await execute(request, ValidateRequest)


@router.post("/solve")
async def solve_route(request: Request):
    return await execute(request, SolveRequest, True)
