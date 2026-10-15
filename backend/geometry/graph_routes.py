import json
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from .graph_models import ValidateRequest,GraphResponse
from .faces import inspect

router=APIRouter(prefix='/api/plan')
async def read_request(request,model):
    body=bytearray()
    async for part in request.stream():
        body.extend(part)
        if len(body)>2*1024*1024:return JSONResponse({'error':{'code':'body_limit','message':'Запрос больше 2 МиБ.'}},status_code=413)
    try:return model.model_validate_json(body)
    except (ValueError,ValidationError):return JSONResponse({'error':{'code':'invalid_request','message':'Проверьте поля и связи плана.'}},status_code=422)

@router.post('/validate')
async def validate_route(request:Request):
    req=await read_request(request,ValidateRequest)
    if isinstance(req,JSONResponse):return req
    try:
        result=inspect(req.graph.model_dump(exclude_none=True))
        payload=dict(schemaVersion=4,requestId=req.requestId,draftRevision=req.draftRevision,basisKey=req.basisKey,**result)
        GraphResponse.model_validate(payload)
        return payload
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Graph validation failed')
        return JSONResponse({'error':{'code':'internal_error','message':'Не удалось проверить план. Повторите запрос.'}},status_code=500)

from .graph_models import CommandRequest
from .graph_commands import execute

@router.post('/command')
async def command_route(request:Request):
    req=await read_request(request,CommandRequest)
    if isinstance(req,JSONResponse):return req
    try:
        result=execute(req.graph.model_dump(exclude_none=True),req.command.model_dump(exclude_none=True),req.commandId)
        payload=dict(schemaVersion=4,commandId=req.commandId,draftRevision=req.draftRevision,basisKey=req.basisKey,**result)
        GraphResponse.model_validate(payload)
        return payload
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Graph command failed')
        return JSONResponse({'error':{'code':'internal_error','message':'Не удалось выполнить действие. Черновик сохранён; повторите запрос.'}},status_code=500)


from .graph_models import DeletionPreviewRequest, DeletionPreviewResponse
from .deletion import plan_deletion
from .graph_validation import GeometryRejection

@router.post('/deletion-preview')
async def deletion_preview_route(request: Request):
    req = await read_request(request, DeletionPreviewRequest)
    if isinstance(req, JSONResponse):
        return req
    try:
        target = req.target.model_dump(exclude_none=True)
        try:
            impact = plan_deletion(req.graph.model_dump(exclude_none=True), target)
            status, issues = 'ready', []
        except GeometryRejection as exc:
            impact, status, issues = None, 'invalid', exc.issues
        return DeletionPreviewResponse(schemaVersion=4, requestId=req.requestId, draftRevision=req.draftRevision,
            basisKey=req.basisKey, target=target, status=status, impact=impact, issues=issues).model_dump(exclude_none=False)
    except Exception:
        import logging
        logging.getLogger(__name__).exception('Deletion preview failed')
        return JSONResponse({'error':{'code':'internal_error','message':'Не удалось подготовить удаление. Повторите запрос.'}},status_code=500)
