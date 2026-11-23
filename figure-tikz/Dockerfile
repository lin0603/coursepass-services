FROM texlive/texlive:latest

RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 poppler-utils \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv
COPY server.py /srv/server.py
ENV PORT=8390 HOME=/tmp
EXPOSE 8390
USER 65534:65534
CMD ["python3", "/srv/server.py"]
