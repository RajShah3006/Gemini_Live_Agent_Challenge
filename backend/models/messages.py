from pydantic import BaseModel


class ClientMessage(BaseModel):
    type: str
    payload: dict


class ServerMessage(BaseModel):
    type: str
    payload: dict


class WhiteboardCommand(BaseModel):
    action: str
    params: dict
