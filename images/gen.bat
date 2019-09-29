@echo off
setlocal enabledelayedexpansion

set F=
for %%f in (icon_play icon_pause icon_next icon_prev icon_back10 icon_next10 icon_volume icon_mute) do (
  msdfgen.exe -svg %%f.svg -o %%f.png -size 32 32 -scale 0.5
  set F=!F! %%f.png
)

echo %F%
go run pack.go -o icons.png %F%
