FROM texlive/texlive:latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY server.py /srv/server.py
ENV PORT=8391
EXPOSE 8391
CMD ["python3", "/srv/server.py"]
