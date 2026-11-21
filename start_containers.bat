@echo off
set "PATH=C:\Users\harno\AppData\Local\Programs\DockerDesktop\resources\bin;%PATH%"
docker compose -f "D:\DBMS PROJECT\docker-compose.yml" up -d
